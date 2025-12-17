import './style.css'
import { auth, db, storage } from './firebaseConfig'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadString, uploadBytes, getDownloadURL } from 'firebase/storage'

// ============================================
// 🎯 앱 상태 관리
// ============================================
let currentPage = 'intro' // intro, concept, trace, practice, project, reflection
let conceptStep = 0 // 개념 페이지 단계: 0=소개, 1=for문, 2=while문, 3=break/continue, 4=정리, 5=퀴즈
let miniEditorOpen = false
let miniEditorMinimized = false
let miniEditorCode = `# 🔄 반복문 예제
for i in range(5):
    print(i)`

// 시작 화면 학생 정보
let introFormVisible = false
let studentInfo = {
  klass: '',
  number: '',
  name: ''
}

// 미니 에디터 스텝 모드 상태
let miniStepMode = false
let miniStepTrace = []
let miniStepIndex = -1
let miniStepOutput = []
let miniStepError = ''

// 순서도 표시 상태
let showFlowchart = false

// 챗봇 상태
let chatMessages = []
let apiKeyStatus = 'checking' // checking, valid, invalid, empty

// Firebase 로그인 사용자 (student.html에서 사용)
let firebaseUser = null

// ACE Editor 인스턴스 (실행 흐름 페이지)
let traceEditor = null

// 레이아웃 모드 (mobile/desktop)
let layoutMode = localStorage.getItem('layoutMode') || 'desktop' // 기본값: desktop

// ============================================
// ✏️ 문제 페이지 상태 관리
// ============================================
let practiceDifficulty = null // null, 'beginner', 'intermediate', 'advanced'
let practiceProblemList = []
let currentProblemIndex = -1 // -1: 목록 화면, 0 이상: 문제 해결 화면
let practiceCode = ''
let practiceTrace = []
let practiceTraceIndex = 0
let practiceEditor = null // ACE Editor 인스턴스 (문제 페이지용)
let practiceHintVisible = false

// ============================================
// 🔑 OpenAI API 키 (환경변수에서 가져오기)
// ============================================
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''

// API 키 유효성 검사
const checkApiKey = async () => {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === '여기에_API_키를_입력하세요') {
    apiKeyStatus = 'empty'
    return
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      }
    })
    
    if (response.ok) {
      apiKeyStatus = 'valid'
    } else {
      apiKeyStatus = 'invalid'
    }
  } catch (error) {
    apiKeyStatus = 'invalid'
  }
  
  // UI 업데이트
  updateApiKeyStatusUI()
}

// API 키 상태 UI 업데이트
const updateApiKeyStatusUI = () => {
  const statusElement = document.querySelector('#api-status')
  if (!statusElement) return
  
  const statusConfig = {
    checking: { text: '🔄 API 키 확인 중...', class: 'status-checking' },
    valid: { text: '✅ API 키 정상 작동', class: 'status-valid' },
    invalid: { text: '❌ API 키가 유효하지 않아요', class: 'status-invalid' },
    empty: { text: '⚠️ API 키가 설정되지 않았어요', class: 'status-empty' }
  }
  
  const config = statusConfig[apiKeyStatus]
  statusElement.textContent = config.text
  statusElement.className = `api-status ${config.class}`
}

// ============================================
// 🐍 파이썬 관련 코드
// ============================================
const starterCode = `# 🔄 for 반복문 예제
for i in range(5):
    print(i)`

let lastValidPythonCode = ''

// Skulpt를 사용한 Python 문법 검사
const checkPythonSyntax = (code) => {
  const sk = typeof window !== 'undefined' ? window.Sk : undefined

  if (!code.trim()) {
    return { valid: true, error: null, lineNum: null, type: null }
  }

  if (!sk || !sk.compile) {
    return { valid: true, error: null, lineNum: null, type: null }
  }

  try {
    const compiled = sk.compile(code, '<stdin>', 'exec', false)
    return { valid: true, error: null, lineNum: null, type: null }
  } catch (err) {
    let errorMsg = String(err)

    // Skulpt 내부 버그로 인해 발생하는 특정 TypeError는
    // 문법 오류가 아니라 엔진 문제이므로 통과 처리
    if (errorMsg.includes('Object prototype may only be an Object or null')) {
      console.warn('Skulpt 내부 오류로 문법 검사를 건너뜁니다:', err)
      return { valid: true, error: null, lineNum: null, type: null }
    }

    let lineNum = null
    let type = null

    if (err.traceback) {
      const tracebackStr = err.traceback.toString()
      const lineMatch = tracebackStr.match(/line (\d+)/) || errorMsg.match(/line (\d+)/)
      if (lineMatch) {
        lineNum = parseInt(lineMatch[1], 10)
      }
      errorMsg = tracebackStr
    } else {
      const lineMatch = errorMsg.match(/line (\d+)/)
      if (lineMatch) {
        lineNum = parseInt(lineMatch[1], 10)
      }
    }

    if (errorMsg.includes('SyntaxError')) {
      type = 'SyntaxError'
    } else if (errorMsg.includes('IndentationError')) {
      type = 'IndentationError'
    } else if (errorMsg.includes('NameError')) {
      type = 'NameError'
    }

    return { valid: false, error: errorMsg, lineNum, type }
  }
}

let pyodideReady = null
let playbackTimer = null
let playbackIndex = 0
let latestTrace = []

// 파이썬 도우미 스텝 실행 상태
let pythonStepMode = false
let pythonStepIndex = -1
let pythonStepOutput = []
let pythonCode = `# 🔄 for 반복문 예제
for i in range(5):
    print(i)`

const loadPyodideInstance = async () => {
  if (pyodideReady) return pyodideReady
  pyodideReady = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js'
    script.onload = async () => {
      try {
        const py = await window.loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/'
        })
        resolve(py)
      } catch (err) {
        reject(err)
      }
    }
    script.onerror = reject
    document.body.appendChild(script)
  })
  return pyodideReady
}

const escapeForPython = (code) =>
  code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/'''/g, "\\'\\'\\'")

const classifyLine = (line) => {
  const trimmed = line.trim()
  if (trimmed.startsWith('if') || trimmed.startsWith('elif') || trimmed.startsWith('else')) return 'diamond'
  if (trimmed.startsWith('for') || trimmed.startsWith('while')) return 'diamond'
  if (trimmed.startsWith('input') || trimmed.includes('input(')) return 'parallelogram'
  return 'rect'
}

const friendlyExplain = (errorText) => {
  if (!errorText) return '실행이 성공적으로 끝났어요! 👏'
  const lower = errorText.toLowerCase()
  if (lower.includes('syntax')) return '문법 오류가 있어요. 괄호나 콜론(:)이 빠지지 않았는지 확인해 볼까요? 🔍'
  if (lower.includes('indent')) return '들여쓰기(스페이스 4칸)가 맞지 않아요. 같은 블록은 같은 깊이로 맞춰주세요. 📏'
  if (lower.includes('nameerror')) return '아직 만들어지지 않은 변수 이름이 있어요. 철자와 선언 순서를 확인해 주세요. ✏️'
  if (lower.includes('typeerror')) return '자료형이 맞지 않는 연산이 있어요. 숫자와 문자열이 섞이지 않았는지 살펴봐요. 🔢'
  if (lower.includes('zero division')) return '0으로 나누는 부분이 있어요. 나누기 전에 0인지 확인하는 조건을 넣어볼까요? ➗'
  return '오류가 있어요. 메시지를 천천히 읽으며 어떤 줄에서 발생했는지 확인해 봅시다. 🧐'
}

const renderFlow = (trace) => {
  const flow = document.querySelector('#flowchart')
  if (!flow) return
  if (!trace.length) {
    flow.innerHTML = '<p class="muted">🎨 아직 실행 기록이 없어요. 코드를 실행해 보세요!</p>'
    return
  }

  const parts = []
  parts.push('<div class="flow-node ellipse">🚀 시작</div>')
  parts.push('<div class="flow-arrow single">↓</div>')

  trace.forEach((step, idx) => {
    const type = classifyLine(step.source || '')
    const label = step.source?.trim() || `line ${step.line}`
    const node = `
      <div class="flow-node ${type}">
        <span class="flow-index">${idx + 1}</span>
        <div>${label}</div>
      </div>`

    if (type === 'diamond') {
      parts.push(`
        ${node}
        <div class="flow-branch lr">
          <div class="flow-arrow no">❌ 아니요 →</div>
          <div class="flow-merge"></div>
          <div class="flow-arrow yes">← ✅ 예</div>
        </div>`)
      if (idx < trace.length - 1) {
        parts.push('<div class="flow-arrow single">↓</div>')
      }
    } else {
      parts.push(node)
      if (idx < trace.length - 1) {
        parts.push('<div class="flow-arrow single">↓</div>')
      }
    }
  })

  parts.push('<div class="flow-arrow single">↓</div>')
  parts.push('<div class="flow-node ellipse end">🏁 끝</div>')
  flow.innerHTML = parts.join('')
}

const renderCodePreview = (code, activeLine) => {
  const view = document.querySelector('#code-preview')
  if (!view) return
  const lines = code.split('\n')
  const html = lines
    .map((line, idx) => {
      const lineNumber = idx + 1
      const isActive = activeLine === lineNumber
      return `<div class="code-line ${isActive ? 'active' : ''}">
        <span class="code-lno">${lineNumber.toString().padStart(2, '0')}</span>
        <span class="code-text">${line || '&nbsp;'}</span>
      </div>`
    })
    .join('')
  view.innerHTML = html
}

const renderTraceList = (trace, currentIndex) => {
  const list = document.querySelector('#trace-list')
  if (!list) return
  if (!trace.length) {
    list.innerHTML = '<p class="muted">📝 실행 기록이 여기에 표시됩니다.</p>'
    return
  }

  list.innerHTML = trace
    .map((t, idx) => {
      const active = idx === currentIndex
      const locals = Object.entries(t.locals || {})
        .map(([k, v]) => `<span class="pill tiny">${k} = ${v}</span>`)
        .join(' ')
      return `<div class="trace-item ${active ? 'active' : ''}">
        <div class="trace-head">
          <span class="pill tiny">📍 line ${t.line}</span>
          <span class="trace-source">${t.source || ''}</span>
        </div>
        <div class="trace-vars">${locals || '<span class="muted">변수 변화 없음</span>'}</div>
      </div>`
    })
    .join('')
}

const renderVars = (trace, currentIndex) => {
  const box = document.querySelector('#var-box')
  if (!box) return
  const current = trace[currentIndex] || trace[trace.length - 1]
  if (!current) {
    box.innerHTML = '<p class="muted">📦 변수 변화가 여기에 표시됩니다.</p>'
    return
  }
  const rows = Object.entries(current.locals || {}).map(
    ([k, v]) => `<div class="var-row"><span>🏷️ ${k}</span><span>${v}</span></div>`
  )
  box.innerHTML = rows.join('') || '<p class="muted">아직 변수가 없어요.</p>'
}

const stopPlayback = () => {
  if (playbackTimer) {
    clearInterval(playbackTimer)
    playbackTimer = null
  }
}

const startPlayback = (code) => {
  stopPlayback()
  playbackIndex = 0
  const indicator = document.querySelector('#playback-state')
  if (indicator) indicator.textContent = '⏳ 실행 흐름을 따라가는 중...'
  playbackTimer = setInterval(() => {
    const step = latestTrace[playbackIndex]
    renderCodePreview(code, step?.line)
    renderTraceList(latestTrace, playbackIndex)
    renderVars(latestTrace, playbackIndex)
    playbackIndex += 1
    if (playbackIndex >= latestTrace.length) {
      stopPlayback()
      if (indicator) indicator.textContent = '✅ 재생 완료!'
    }
  }, 900)
}

const runPython = async (code) => {
  const pyodide = await loadPyodideInstance()
  const pyCode = escapeForPython(code)
  const program = `
import sys, json, traceback
code = """${pyCode}"""
lines = code.splitlines()
trace_log = []
current_output = []

class OutputCapture:
    def write(self, text):
        current_output.append(text)
    def flush(self):
        pass

old_stdout = sys.stdout
sys.stdout = OutputCapture()

def tracer(frame, event, arg):
    global current_output
    if event == 'line':
        ln = frame.f_lineno
        # 내부 변수 제외
        skip_vars = {'self', 'text', 'arg', 'frame', 'event', 'tracer', 'ns', 'code', 'lines', 'trace_log', 'current_output', 'old_stdout', 'status', 'error', 'OutputCapture'}
        local_vars = {k: repr(v) for k, v in frame.f_locals.items() if not k.startswith('__') and k not in skip_vars}
        src = lines[ln-1] if 0 <= ln-1 < len(lines) else ''
        
        # 현재까지의 출력 저장
        output_snapshot = list(current_output)
        trace_log.append({
            "line": ln, 
            "locals": local_vars, 
            "source": src,
            "output": output_snapshot
        })
    return tracer

sys.settrace(tracer)
status = "ok"
error = ""
try:
    ns = {}
    exec(code, ns, ns)
except Exception as e:
    status = "error"
    error = f"{e.__class__.__name__}: {e}"
finally:
    sys.settrace(None)
    sys.stdout = old_stdout

# 마지막 출력 상태 저장
final_output = list(current_output)

json.dumps({"status": status, "error": error, "trace": trace_log, "output": final_output})
`
  const resultText = await pyodide.runPythonAsync(program)
  return JSON.parse(resultText)
}

// ============================================
// 🤖 ChatGPT API 호출 (수업 후기 챗봇)
// ============================================
const sendToChatGPT = async (userMessage) => {
  if (!OPENAI_API_KEY || apiKeyStatus !== 'valid') {
    return '🔑 API 키가 설정되지 않았거나 유효하지 않아요. .env 파일에 VITE_OPENAI_API_KEY를 확인해주세요!'
  }
  
  // 수업 후기 챗봇 시스템 프롬프트
  const systemPrompt = `너는 코딩 수업 후기를 수집하는 친근한 챗봇이야. 
이름은 "기말이"야.
학생들에게 오늘 수업에 대한 후기를 물어보고, 그들의 대답에 공감하며 대화해줘.

대화 가이드라인:
1. 항상 친근하고 따뜻하게 대화해
2. 이모지를 적절히 사용해 귀엽게 표현해
3. 학생의 대답에 공감하고 격려해줘
4. 자연스럽게 다음 질문으로 이어가
5. 답변은 2-3문장 정도로 짧게 해줘

수업 후기로 물어볼 것들:
- 오늘 수업에서 가장 재미있었던 부분
- 어려웠던 부분이나 이해가 안 됐던 내용
- 다음에 더 배우고 싶은 것
- 수업에 대한 전반적인 만족도
- 선생님께 하고 싶은 말

대화를 자연스럽게 이끌어가며 학생의 솔직한 후기를 받아줘.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatMessages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.8
      })
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      return `❌ 오류가 발생했어요: ${errorData.error?.message || '알 수 없는 오류'}`
    }
    
    const data = await response.json()
    return data.choices[0].message.content
  } catch (error) {
    return `❌ 네트워크 오류가 발생했어요: ${error.message}`
  }
}

// ============================================
// 🎨 페이지 렌더링 함수들
// ============================================

// 레이아웃 선택기 렌더링 (왼쪽 아래)
const renderLayoutSelector = () => {
  return `
    <div class="layout-selector">
      <label for="layout-mode-select" class="layout-selector-label">
        <span class="layout-icon">📱</span>
        <span class="layout-text">레이아웃</span>
      </label>
      <select id="layout-mode-select" class="layout-select">
        <option value="mobile" ${layoutMode === 'mobile' ? 'selected' : ''}>모바일</option>
        <option value="desktop" ${layoutMode === 'desktop' ? 'selected' : ''}>웹사이트</option>
      </select>
          </div>
  `
}

const renderNavigation = () => {
  return `
    <nav class="cute-nav">
      <div class="nav-left">
        <div class="nav-logo" id="go-home" style="cursor: pointer;">
          <span class="logo-icon">🐍</span>
          <span class="logo-text">
            <span class="logo-main">다영쌤과 함께 하는 정보수업</span>
            <span class="logo-sub">Ⅲ 프로그래밍 · 4. 제어 구조 - 반복문</span>
            <span class="logo-highlight">반복문 수업</span>
          </span>
        </div>
        </div>
      <div class="nav-tabs">
        <button class="nav-tab ${currentPage === 'concept' ? 'active' : ''}" data-page="concept">
          <span class="tab-icon">📚</span>
          <span class="tab-text">개념</span>
        </button>
        <button class="nav-tab ${currentPage === 'trace' ? 'active' : ''}" data-page="trace">
          <span class="tab-icon">🔍</span>
          <span class="tab-text">실행 흐름</span>
        </button>
        <button class="nav-tab ${currentPage === 'practice' ? 'active' : ''}" data-page="practice">
          <span class="tab-icon">✏️</span>
          <span class="tab-text">문제</span>
        </button>
        <button class="nav-tab ${currentPage === 'project' ? 'active' : ''}" data-page="project">
          <span class="tab-icon">🎨</span>
          <span class="tab-text">프로젝트</span>
        </button>
        <button class="nav-tab ${currentPage === 'reflection' ? 'active' : ''}" data-page="reflection">
          <span class="tab-icon">💭</span>
          <span class="tab-text">성찰</span>
        </button>
      </div>
      <div class="nav-right">
        ${firebaseUser ? `
          <div class="nav-user-info">
            <span class="user-name">${firebaseUser.displayName || '학생'}</span>
            ${firebaseUser.email ? `<span class="user-email">${firebaseUser.email}</span>` : ''}
          </div>
          <button class="btn mini ghost" id="student-logout-btn">로그아웃</button>
        ` : ''}
      </div>
    </nav>
  `
}

// 시작 페이지
const renderIntroPage = () => {
  return `
    <div class="intro-page">
      <div class="intro-background">
        <div class="intro-shape shape-1">🔄</div>
        <div class="intro-shape shape-2">🐍</div>
        <div class="intro-shape shape-3">💻</div>
        <div class="intro-shape shape-4">🔁</div>
        <div class="intro-shape shape-5">✨</div>
        <div class="intro-shape shape-6">📚</div>
            </div>
      
      <div class="intro-content">
        <div class="intro-logo">🐍</div>
        <h1 class="intro-title">다영쌤과 함께하는 정보 수업</h1>
        <p class="intro-subtitle">Ⅲ 프로그래밍 · 4. 제어 구조 - 반복문</p>
        
        <div class="intro-objectives">
          <div class="objectives-title">🎯 학습 목표</div>
          <div class="objectives-list">
            <div class="objective-item">
              <span class="objective-icon">1</span>
              <div class="objective-content">
                <h3>반복문의 개념 이해</h3>
                <p>for문과 while문의 차이점과 사용 시기를 구분할 수 있다</p>
              </div>
            </div>
            <div class="objective-item">
              <span class="objective-icon">2</span>
              <div class="objective-content">
                <h3>코드 실행 흐름 파악</h3>
                <p>반복문이 실행되는 과정을 단계별로 추적하고 이해할 수 있다</p>
              </div>
            </div>
            <div class="objective-item">
              <span class="objective-icon">3</span>
              <div class="objective-content">
                <h3>실전 문제 해결</h3>
                <p>다양한 난이도의 문제를 반복문으로 해결할 수 있다</p>
              </div>
            </div>
            <div class="objective-item">
              <span class="objective-icon">4</span>
              <div class="objective-content">
                <h3>프로젝트 적용</h3>
                <p>실제 프로젝트에서 반복문을 활용하여 프로그램을 작성할 수 있다</p>
              </div>
            </div>
          </div>
        </div>
        
        <div class="student-info-card">
          <h3>📝 수업 전 내 정보 입력하기</h3>
          <p class="student-info-desc">출석과 학습 기록을 위해 아래 정보를 간단히 적어주세요.</p>
          <div class="student-info-grid">
            <div class="student-field">
              <label for="student-class">반</label>
              <input id="student-class" type="text" placeholder="예: 1-10" value="${studentInfo.klass}">
            </div>
            <div class="student-field">
              <label for="student-number">번호</label>
              <input id="student-number" type="text" placeholder="예: 12" value="${studentInfo.number}">
            </div>
            <div class="student-field full">
              <label for="student-name">이름</label>
              <input id="student-name" type="text" placeholder="예:정다영" value="${studentInfo.name}">
            </div>
          </div>
          <button class="intro-btn start-learning-btn" id="student-start-btn">
            <span>반복문 수업 시작하기</span>
            <span class="btn-arrow">→</span>
          </button>
        </div>
        
        <div class="intro-features">
          <div class="intro-feature">
            <span class="feature-icon">📚</span>
            <span>개념 & 퀴즈</span>
          </div>
          <div class="intro-feature">
            <span class="feature-icon">🔍</span>
            <span>코드 실행 시각화</span>
          </div>
          <div class="intro-feature">
            <span class="feature-icon">💭</span>
            <span>수업 성찰</span>
          </div>
        </div>
      </div>
    </div>
  `
}

// 개념 페이지 단계 정보
const conceptSteps = [
  { id: 0, title: '반복문 소개', icon: '💡', short: '소개' },
  { id: 1, title: 'for문', icon: '🔁', short: 'for' },
  { id: 2, title: 'while문', icon: '🔄', short: 'while' },
  { id: 3, title: 'break & continue', icon: '🚦', short: 'break' },
  { id: 4, title: '핵심 정리', icon: '📌', short: '정리' },
  { id: 5, title: '줄 토글 실험', icon: '🔬', short: '실험' },
  { id: 6, title: '퀴즈', icon: '✅', short: '퀴즈' }
]

// 줄 토글 실험 상태
let experimentLines = {
  print: true,  // print(i) 체크 상태
  increment: true  // i += 1 체크 상태
}
let experimentRunning = false
let experimentStep = 0
let experimentOutput = []
let experimentHighlight = -1

// 딜레이 함수
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// 실험 UI 업데이트 (페이지 새로고침 없이)
const updateExperimentUI = (currentI) => {
  // 변수 값 업데이트
  const iValue = document.querySelector('#experiment-i-value')
  if (iValue) {
    iValue.textContent = currentI
    iValue.classList.add('pulse')
    setTimeout(() => iValue.classList.remove('pulse'), 300)
  }
  
  // 출력 영역 업데이트
  const outputEl = document.querySelector('.experiment-output')
  if (outputEl) {
    if (experimentOutput.length > 0) {
      outputEl.textContent = experimentOutput.join('\n')
      outputEl.classList.remove('empty')
    } else {
      outputEl.textContent = '(출력 없음)'
      outputEl.classList.add('empty')
    }
  }
  
  // 코드 라인 하이라이트 업데이트
  const codeLines = document.querySelectorAll('.experiment-code-box .code-line')
  codeLines.forEach((line, idx) => {
    line.classList.remove('highlight')
    if (idx === experimentHighlight) {
      line.classList.add('highlight')
    }
  })
}

const renderConceptPage = () => {
  const step = conceptSteps[conceptStep] || conceptSteps[0]
  
  return `
    <div class="page-content concept-page step-view">
      <!-- 상단 진행 바 -->
      <div class="concept-progress-bar">
        ${conceptSteps.map((s, i) => `
          <button class="progress-step ${i === conceptStep ? 'active' : ''} ${i < conceptStep ? 'completed' : ''}" data-step="${i}">
            <span class="step-icon">${s.icon}</span>
            <span class="step-label">${s.short}</span>
          </button>
        `).join('<div class="progress-line"></div>')}
      </div>
      
      <!-- 메인 콘텐츠 -->
      <div class="concept-step-content">
        ${renderConceptStepContent()}
      </div>
      
      <!-- 하단 네비게이션 -->
      <div class="concept-nav-bar">
        <button class="btn ghost" id="concept-prev" ${conceptStep <= 0 ? 'disabled' : ''}>
          ◀️ 이전
        </button>
        <div class="concept-nav-info">
          <span class="nav-step">${conceptStep + 1} / ${conceptSteps.length}</span>
          <span class="nav-title">${step.icon} ${step.title}</span>
        </div>
        <button class="btn primary" id="concept-next">
          ${conceptStep >= conceptSteps.length - 1 ? '실행 흐름 보기 →' : '다음 ▶️'}
        </button>
      </div>
    </div>
  `
}

// 각 단계별 콘텐츠
const renderConceptStepContent = () => {
  switch(conceptStep) {
    case 0: return renderStep0Intro()
    case 1: return renderStep1For()
    case 2: return renderStep2While()
    case 3: return renderStep3Break()
    case 4: return renderStep4Summary()
    case 5: return renderStep5Experiment()
    case 6: return renderStep6Quiz()
    default: return renderStep0Intro()
  }
}

// Step 0: 반복문 소개 상태
let introClicks = 0
let introShowMagic = false

// Step 0: 반복문 소개
const renderStep0Intro = () => `
  <div class="step-card intro-step">
    <div class="step-header">
      <div class="step-emoji bounce">🎮</div>
      <h2>반복문의 마법을 경험해보세요!</h2>
    </div>

    <!-- 미니 게임: 클릭 챌린지 -->
    <div class="intro-game">
      <div class="game-challenge">
        <div class="challenge-text">
          <span class="challenge-icon">🎯</span>
          <p>미션: 아래 버튼을 <strong>10번</strong> 클릭하세요!</p>
        </div>
        <div class="click-area">
          <button class="click-btn ${introClicks >= 10 ? 'done' : ''}" id="intro-click-btn">
            ${introClicks >= 10 ? '🎉 완료!' : '👆 클릭!'}
          </button>
          <div class="click-counter">
            <span class="counter-num">${introClicks}</span>
            <span class="counter-label">/ 10</span>
          </div>
        </div>
        ${introClicks >= 10 ? `
          <div class="click-result tired">
            <span>😫</span>
            <p>힘들었죠? 이걸 100번 해야 한다면요?</p>
          </div>
        ` : ''}
      </div>
    </div>

    ${introClicks >= 10 ? `
      <!-- 마법 소개 -->
      <div class="magic-reveal ${introShowMagic ? 'show' : ''}">
        <div class="magic-header">
          <span class="magic-icon">✨</span>
          <h3>반복문의 마법!</h3>
        </div>
        
        <div class="magic-demo">
          <button class="magic-btn" id="show-magic-btn">
            🪄 마법 보기
          </button>
          
          ${introShowMagic ? `
            <div class="magic-output" id="magic-output">
              <div class="output-item appear-1">👆 클릭! (1번째)</div>
              <div class="output-item appear-2">👆 클릭! (2번째)</div>
              <div class="output-item appear-3">👆 클릭! (3번째)</div>
              <div class="output-item appear-4">... (자동으로 계속)</div>
              <div class="output-item appear-5">👆 클릭! (10번째)</div>
              <div class="output-item appear-6 done">🎉 완료!</div>
            </div>
          ` : ''}
        </div>
        
        <div class="magic-code">
          <div class="code-label">✨ 단 2줄의 코드:</div>
          <pre class="magic-code-block"><span class="py-keyword">for</span> i <span class="py-keyword">in</span> <span class="py-function">range</span>(<span class="py-number">10</span>):
    <span class="py-function">print</span>(<span class="py-string">"👆 클릭!"</span>)</pre>
        </div>
      </div>
    ` : ''}

    <!-- 비교 카드 -->
    <div class="intro-comparison ${introClicks >= 10 ? 'reveal' : 'hidden'}">
      <div class="compare-card human">
        <div class="compare-icon">😓</div>
        <div class="compare-title">사람이 직접</div>
        <div class="compare-stat">
          <span class="stat-num">${introClicks}</span>
          <span class="stat-unit">번 클릭</span>
        </div>
        <div class="compare-time">⏱️ ${Math.max(1, Math.floor(introClicks / 2))}초 걸림</div>
      </div>
      
      <div class="compare-vs">VS</div>
      
      <div class="compare-card computer">
        <div class="compare-icon">💻</div>
        <div class="compare-title">반복문 사용</div>
        <div class="compare-stat">
          <span class="stat-num">2</span>
          <span class="stat-unit">줄 코드</span>
        </div>
        <div class="compare-time">⚡ 0.001초</div>
      </div>
    </div>

    <!-- 일상 속 반복 -->
    <div class="daily-loops">
      <h4>🌍 일상 속 반복문</h4>
      <div class="daily-cards">
        <div class="daily-card">
          <span class="daily-icon">🍳</span>
          <span class="daily-text">매일 아침 식사</span>
          <span class="daily-loop">365번 반복</span>
        </div>
        <div class="daily-card">
          <span class="daily-icon">🎵</span>
          <span class="daily-text">좋아하는 노래</span>
          <span class="daily-loop">무한 반복 🔁</span>
        </div>
        <div class="daily-card">
          <span class="daily-icon">🏃</span>
          <span class="daily-text">운동장 달리기</span>
          <span class="daily-loop">n바퀴 반복</span>
        </div>
        <div class="daily-card">
          <span class="daily-icon">📱</span>
          <span class="daily-text">SNS 새로고침</span>
          <span class="daily-loop">??? 반복 😅</span>
        </div>
      </div>
    </div>

    <div class="step-tip fun">
      <span class="tip-icon">💡</span>
      <div class="tip-content">
        <strong>핵심 발견!</strong>
        <p>컴퓨터는 반복을 싫어하지 않아요. 오히려 <em>반복은 컴퓨터의 특기</em>예요!</p>
      </div>
    </div>
  </div>
`

// for문 인터랙티브 상태
let forRangeValue = 5
let forRunning = false
let forCurrentI = -1
let forOutput = []

// while문 인터랙티브 상태
let whileTargetNum = 3  // 목표 숫자
let whileCurrentGuess = 0
let whileRunning = false
let whileGuesses = []
let whileFound = false

// while 카운트다운 상태
let countdownStart = 5
let countdownCurrent = -1
let countdownRunning = false
let countdownOutput = []

// Step 1: for문
const renderStep1For = () => {
  // range 값 생성
  const rangeNumbers = []
  for (let i = 0; i < forRangeValue; i++) {
    rangeNumbers.push(i)
  }

  return `
  <div class="step-card for-step">
    <div class="step-header">
      <div class="step-emoji">🔁</div>
      <h2>for문 - 횟수가 정해진 반복</h2>
    </div>

    <!-- 개념 설명 영역 -->
    <div class="concept-explain">
      <div class="when-to-use">
        <span class="use-icon">🤔</span>
        <p><strong>언제 사용하나요?</strong> 반복 횟수가 <em>정해져 있을 때</em> 사용해요!</p>
      </div>
      
      <div class="real-examples">
        <div class="real-ex">
          <span class="ex-icon">🏃</span>
          <span>"운동장 <strong>5바퀴</strong> 돌기"</span>
        </div>
        <div class="real-ex">
          <span class="ex-icon">🎵</span>
          <span>"노래 <strong>3번</strong> 반복"</span>
        </div>
        <div class="real-ex">
          <span class="ex-icon">📝</span>
          <span>"문제 <strong>10개</strong> 풀기"</span>
        </div>
      </div>
    </div>
    
    <!-- 기본 구조 설명 -->
    <div class="syntax-box">
      <div class="syntax-header">
        <span class="syntax-icon">📖</span>
        <h4>for문 기본 구조</h4>
      </div>
      <div class="syntax-content">
        <pre class="syntax-code"><span class="py-keyword">for</span> <span class="syntax-var">변수</span> <span class="py-keyword">in</span> <span class="py-function">range</span>(<span class="syntax-var">반복횟수</span>):
    <span class="syntax-comment"># 반복할 코드 (들여쓰기 필수!)</span></pre>
        <div class="syntax-parts">
          <div class="part">
            <span class="part-name">for</span>
            <span class="part-desc">"~동안 반복해"</span>
          </div>
          <div class="part">
            <span class="part-name">변수</span>
            <span class="part-desc">현재 몇 번째인지 기억</span>
          </div>
          <div class="part">
            <span class="part-name">range(n)</span>
            <span class="part-desc">0부터 n-1까지 숫자 생성</span>
          </div>
          <div class="part">
            <span class="part-name">:</span>
            <span class="part-desc">콜론 필수!</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 실행 과정 시각화 -->
    <div class="execution-flow">
      <h4>🔄 for문이 실행되는 과정</h4>
      <div class="flow-steps">
        <div class="flow-step">
          <div class="flow-num">1</div>
          <div class="flow-content">
            <div class="flow-code">for i in range(3):</div>
            <div class="flow-desc">range(3)이 [0, 1, 2]를 만듦</div>
          </div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step">
          <div class="flow-num">2</div>
          <div class="flow-content">
            <div class="flow-code">i = 0</div>
            <div class="flow-desc">첫 번째 값을 i에 저장</div>
          </div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step">
          <div class="flow-num">3</div>
          <div class="flow-content">
            <div class="flow-code">print(i)</div>
            <div class="flow-desc">들여쓰기된 코드 실행</div>
          </div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step repeat">
          <div class="flow-num">🔄</div>
          <div class="flow-content">
            <div class="flow-desc">다음 값으로 반복!</div>
            <div class="flow-values">i=1, i=2 ...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 인터랙티브 range 조절기 -->
    <div class="for-playground">
      <h3 class="playground-title">🎮 range() 놀이터</h3>
      
      <div class="range-controller">
        <div class="range-slider-area">
          <label>반복 횟수를 조절해보세요!</label>
          <div class="slider-row">
            <input type="range" id="range-slider" min="1" max="10" value="${forRangeValue}">
            <span class="slider-value" id="slider-display">${forRangeValue}</span>
          </div>
        </div>
        
        <div class="live-code">
          <div class="code-preview">
            <pre><span class="py-keyword">for</span> i <span class="py-keyword">in</span> <span class="py-function">range</span>(<span class="py-number range-num">${forRangeValue}</span>):
    <span class="py-function">print</span>(i)</pre>
          </div>
        </div>
      </div>
      
      <!-- 숫자 시각화 -->
      <div class="number-visualizer">
        <div class="viz-label">range(${forRangeValue})가 만드는 숫자들:</div>
        <div class="number-balls" id="number-balls">
          ${rangeNumbers.map(n => `
            <div class="number-ball ${forCurrentI === n ? 'active' : ''} ${forOutput.includes(n) ? 'done' : ''}">
              ${n}
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- 실행 버튼 및 결과 -->
      <div class="for-execution">
        <button class="btn primary for-run-btn" id="run-for-demo" ${forRunning ? 'disabled' : ''}>
          ${forRunning ? '⏳ 실행 중...' : '▶ 실행해보기'}
        </button>
        
        <div class="for-output-area">
          <div class="output-label">출력 결과:</div>
          <div class="output-display" id="for-output-display">
            ${forOutput.length > 0 
              ? forOutput.map(n => `<span class="out-num">${n}</span>`).join('') 
              : '<span class="waiting">실행 버튼을 눌러보세요!</span>'}
          </div>
        </div>
      </div>
    </div>

    <!-- range 팁 카드들 -->
    <div class="range-tips">
      <h4>💡 range() 꿀팁</h4>
      <div class="tip-cards">
        <div class="tip-card" id="tip-1">
          <div class="tip-example">range(<span class="highlight">5</span>)</div>
          <div class="tip-result">→ 0, 1, 2, 3, 4</div>
          <div class="tip-note">0부터 시작!</div>
        </div>
        <div class="tip-card" id="tip-2">
          <div class="tip-example">range(<span class="highlight">1, 6</span>)</div>
          <div class="tip-result">→ 1, 2, 3, 4, 5</div>
          <div class="tip-note">시작점 지정 가능</div>
        </div>
        <div class="tip-card" id="tip-3">
          <div class="tip-example">range(<span class="highlight">0, 10, 2</span>)</div>
          <div class="tip-result">→ 0, 2, 4, 6, 8</div>
          <div class="tip-note">2씩 건너뛰기!</div>
        </div>
      </div>
    </div>

    <!-- 재미있는 활용 예시 -->
    <div class="fun-examples">
      <h4>🎉 for문으로 할 수 있는 것들</h4>
      <div class="fun-cards">
        <button class="fun-card" data-example="stars">
          <span class="fun-icon">⭐</span>
          <span class="fun-text">별 5개 출력</span>
        </button>
        <button class="fun-card" data-example="countdown">
          <span class="fun-icon">🚀</span>
          <span class="fun-text">카운트다운</span>
        </button>
        <button class="fun-card" data-example="gugudan">
          <span class="fun-icon">✖️</span>
          <span class="fun-text">구구단</span>
        </button>
        <button class="fun-card" data-example="emoji">
          <span class="fun-icon">😀</span>
          <span class="fun-text">이모지 행진</span>
        </button>
      </div>
      
      <div class="fun-demo" id="fun-demo-area"></div>
    </div>

    <div class="step-tip fun">
      <span class="tip-icon">🎯</span>
      <div class="tip-content">
        <strong>핵심 포인트!</strong>
        <p>for문은 <em>"몇 번 반복할지 정확히 알 때"</em> 사용해요. range()로 반복 횟수를 정해요!</p>
      </div>
    </div>
  </div>
`
}

// Step 2: while문
const renderStep2While = () => `
  <div class="step-card while-step">
    <div class="step-header">
      <div class="step-emoji">🔄</div>
      <h2>while문 - 조건이 참인 동안 반복</h2>
    </div>

    <!-- 개념 설명 -->
    <div class="concept-explain while-explain">
      <div class="when-to-use">
        <span class="use-icon">🤔</span>
        <p><strong>언제 사용하나요?</strong> 반복 횟수를 <em>모를 때</em>, 특정 조건까지 반복해야 할 때!</p>
      </div>
      
      <div class="real-examples">
        <div class="real-ex">
          <span class="ex-icon">🎯</span>
          <span>"정답 <strong>맞출 때까지</strong>"</span>
        </div>
        <div class="real-ex">
          <span class="ex-icon">🎮</span>
          <span>"게임 <strong>질 때까지</strong>"</span>
        </div>
        <div class="real-ex">
          <span class="ex-icon">🔋</span>
          <span>"배터리 <strong>다 닳을 때까지</strong>"</span>
        </div>
      </div>
    </div>

    <!-- for vs while 비교 -->
    <div class="vs-comparison">
      <div class="vs-item for-side">
        <h4>🔁 for문</h4>
        <p><strong>"5번"</strong> 반복해줘</p>
        <div class="vs-code">for i in range(5):</div>
        <small>횟수가 정해져 있을 때</small>
      </div>
      <div class="vs-badge">VS</div>
      <div class="vs-item while-side">
        <h4>🔄 while문</h4>
        <p><strong>"맞출 때까지"</strong> 반복해줘</p>
        <div class="vs-code">while 조건 == True:</div>
        <small>조건이 중요할 때</small>
      </div>
    </div>

    <!-- 기본 구조 설명 -->
    <div class="syntax-box while-syntax">
      <div class="syntax-header">
        <span class="syntax-icon">📖</span>
        <h4>while문 기본 구조</h4>
      </div>
      <div class="syntax-content">
        <pre class="syntax-code"><span class="py-keyword">while</span> <span class="syntax-var">조건</span>:
    <span class="syntax-comment"># 반복할 코드</span>
    <span class="syntax-comment"># 조건을 변경하는 코드 ← 중요!</span></pre>
        <div class="syntax-parts">
          <div class="part">
            <span class="part-name">while</span>
            <span class="part-desc">"~하는 동안"</span>
          </div>
          <div class="part">
            <span class="part-name">조건</span>
            <span class="part-desc">True면 반복 계속</span>
          </div>
          <div class="part warning-part">
            <span class="part-name">⚠️ 조건 변경</span>
            <span class="part-desc">없으면 무한루프!</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 실행 과정 시각화 -->
    <div class="execution-flow while-flow">
      <h4>🔄 while문이 실행되는 과정</h4>
      <div class="flow-steps while-flow-steps">
        <div class="flow-step">
          <div class="flow-num">1</div>
          <div class="flow-content">
            <div class="flow-code">조건 확인</div>
            <div class="flow-desc">True인지 False인지?</div>
          </div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step">
          <div class="flow-num">2</div>
          <div class="flow-content">
            <div class="flow-code">True면 실행</div>
            <div class="flow-desc">들여쓰기된 코드 실행</div>
          </div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step repeat">
          <div class="flow-num">🔄</div>
          <div class="flow-content">
            <div class="flow-desc">다시 조건 확인!</div>
            <div class="flow-values">무한 반복...</div>
          </div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step stop-step">
          <div class="flow-num">🛑</div>
          <div class="flow-content">
            <div class="flow-code">False면 탈출</div>
            <div class="flow-desc">반복 종료!</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 🎮 인터랙티브: 카운트다운 실험 -->
    <div class="while-playground">
      <h3 class="playground-title">🚀 카운트다운 실험실</h3>
      
      <div class="countdown-controller">
        <div class="countdown-slider-area">
          <label>시작 숫자를 정해보세요!</label>
          <div class="slider-row">
            <input type="range" id="countdown-slider" min="3" max="10" value="${countdownStart}">
            <span class="slider-value" id="countdown-display">${countdownStart}</span>
          </div>
        </div>
        
        <div class="live-code while-live-code">
          <div class="code-preview">
            <pre><span class="py-keyword">count</span> = <span class="py-number countdown-num">${countdownStart}</span>
<span class="py-keyword">while</span> count > 0:
    <span class="py-function">print</span>(count)
    count = count - 1
<span class="py-function">print</span>(<span class="py-string">"발사! 🚀"</span>)</pre>
          </div>
        </div>
      </div>
      
      <!-- 카운트다운 시각화 -->
      <div class="countdown-visualizer">
        <div class="viz-label">count 값의 변화:</div>
        <div class="countdown-balls" id="countdown-balls">
          ${Array.from({length: countdownStart}, (_, i) => countdownStart - i).map(n => `
            <div class="countdown-ball ${countdownCurrent === n ? 'active' : ''} ${countdownOutput.includes(n) ? 'done' : ''}">
              ${n}
            </div>
          `).join('')}
          <div class="countdown-ball rocket ${countdownOutput.includes('🚀') ? 'done' : ''}">🚀</div>
        </div>
      </div>
      
      <!-- 조건 상태 표시 -->
      <div class="condition-display">
        <div class="condition-box" id="condition-box">
          <span class="condition-label">조건: count > 0</span>
          <span class="condition-result" id="condition-result">
            ${countdownCurrent > 0 ? '✅ True (계속!)' : countdownCurrent === 0 ? '❌ False (종료!)' : '🤔 실행 전'}
          </span>
        </div>
      </div>
      
      <!-- 실행 버튼 및 결과 -->
      <div class="while-execution">
        <button class="btn primary while-run-btn" id="run-countdown-demo" ${countdownRunning ? 'disabled' : ''}>
          ${countdownRunning ? '⏳ 실행 중...' : '▶ 카운트다운 시작!'}
        </button>
        
        <div class="while-output-area">
          <div class="output-label">출력 결과:</div>
          <div class="output-display" id="countdown-output-display">
            ${countdownOutput.length > 0 
              ? countdownOutput.map(n => `<span class="out-num ${n === '🚀' ? 'rocket-out' : ''}">${n}</span>`).join('') 
              : '<span class="waiting">실행 버튼을 눌러보세요!</span>'}
          </div>
        </div>
      </div>
    </div>

    <!-- 🎯 무한루프 체험 -->
    <div class="infinite-loop-demo">
      <h4>⚠️ 무한 루프란?</h4>
      <div class="infinite-demo-container">
        <div class="infinite-code">
          <pre><span class="bad-code"><span class="py-keyword">count</span> = 5
<span class="py-keyword">while</span> count > 0:
    <span class="py-function">print</span>(count)
    <span class="py-comment"># count = count - 1 ← 빠짐!</span></span></pre>
          <div class="infinite-warning">
            <span class="warning-icon">💀</span>
            <span>count가 영원히 5! 무한 반복...</span>
          </div>
        </div>
        <div class="infinite-fix">
          <pre><span class="good-code"><span class="py-keyword">count</span> = 5
<span class="py-keyword">while</span> count > 0:
    <span class="py-function">print</span>(count)
    count = count - 1  <span class="py-comment"># ✅ 조건 변경!</span></span></pre>
          <div class="infinite-success">
            <span class="success-icon">✅</span>
            <span>count가 줄어서 0이 되면 종료!</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 활용 예시 -->
    <div class="while-examples">
      <h4>🎉 while문 활용 예시</h4>
      <div class="while-example-cards">
        <button class="while-ex-card" data-while-example="password">
          <span class="while-icon">🔐</span>
          <span class="while-text">비밀번호 맞추기</span>
        </button>
        <button class="while-ex-card" data-while-example="sum">
          <span class="while-icon">➕</span>
          <span class="while-text">합계 계산</span>
        </button>
        <button class="while-ex-card" data-while-example="guess">
          <span class="while-icon">🎲</span>
          <span class="while-text">숫자 맞추기</span>
        </button>
      </div>
      <div class="while-demo-area" id="while-demo-area"></div>
    </div>

    <div class="step-tip fun while-tip">
      <span class="tip-icon">🎯</span>
      <div class="tip-content">
        <strong>핵심 포인트!</strong>
        <p>while문은 <em>"언제 끝날지 모르지만, 특정 조건까지 반복"</em>할 때 사용해요. 꼭 조건을 변경하는 코드를 넣으세요!</p>
      </div>
    </div>
  </div>
`

// break/continue 실험 상태
let bcSelectedBlock = null // 'break' | 'continue' | null
let bcRunning = false
let bcOutput = []
let bcHighlight = -1
let bcFeedback = ''

// break/continue 실험 UI 업데이트
const updateBcExperimentUI = (currentI) => {
  // 변수 값 업데이트
  const iValue = document.querySelector('#bc-i-value')
  if (iValue) {
    iValue.textContent = currentI
    iValue.classList.add('pulse')
    setTimeout(() => iValue.classList.remove('pulse'), 300)
  }
  
  // 출력 영역 업데이트
  const outputEl = document.querySelector('.bc-output')
  if (outputEl) {
    if (bcOutput.length > 0) {
      outputEl.textContent = bcOutput.join('\n')
      outputEl.classList.remove('empty')
    } else {
      outputEl.textContent = '(실행 대기)'
      outputEl.classList.add('empty')
    }
  }
  
  // 코드 라인 하이라이트 업데이트
  const codeLines = document.querySelectorAll('.bc-code-box .bc-code-line')
  codeLines.forEach((line, idx) => {
    line.classList.remove('highlight')
    if (idx === bcHighlight) {
      line.classList.add('highlight')
    }
  })
}

// Step 3: break/continue
const renderStep3Break = () => {
  return `
  <div class="step-card break-step">
    <div class="step-header">
      <div class="step-emoji">🚦</div>
      <h2>break & continue</h2>
    </div>

    <div class="bc-concept-cards">
      <div class="bc-concept break-concept">
        <span class="bc-icon">🛑</span>
        <span class="bc-name">break</span>
        <span class="bc-desc">반복문을 즉시 종료</span>
      </div>
      <div class="bc-concept continue-concept">
        <span class="bc-icon">⏭️</span>
        <span class="bc-name">continue</span>
        <span class="bc-desc">이번 반복만 건너뜀</span>
      </div>
    </div>

    <!-- 드래그 앤 드롭 실험 -->
    <div class="bc-experiment">
      <h3 class="bc-exp-title">🔬 직접 실험해보기</h3>
      
      <div class="bc-exp-container">
        <!-- 왼쪽: 블록 선택 영역 -->
        <div class="bc-blocks-area">
          <p class="bc-blocks-label">블록을 선택하세요:</p>
          <div class="bc-draggable-blocks">
            <button class="bc-block break-block ${bcSelectedBlock === 'break' ? 'selected' : ''}" data-block="break">
              🛑 break
            </button>
            <button class="bc-block continue-block ${bcSelectedBlock === 'continue' ? 'selected' : ''}" data-block="continue">
              ⏭️ continue
            </button>
          </div>
        </div>
        
        <!-- 가운데: 코드 영역 -->
        <div class="bc-code-area">
          <div class="bc-code-box">
            <div class="bc-code-line ${bcHighlight === 0 ? 'highlight' : ''}">
              <span class="line-num">1</span>
              <span class="line-code"><span class="py-keyword">for</span> i <span class="py-keyword">in</span> <span class="py-function">range</span>(<span class="py-number">6</span>):</span>
            </div>
            <div class="bc-code-line ${bcHighlight === 1 ? 'highlight' : ''}">
              <span class="line-num">2</span>
              <span class="line-code"><span class="indent">    </span><span class="py-keyword">if</span> i == <span class="py-number">3</span>:</span>
            </div>
            <div class="bc-code-line drop-zone ${bcHighlight === 2 ? 'highlight' : ''} ${bcSelectedBlock ? 'filled ' + bcSelectedBlock : 'empty'}">
              <span class="line-num">3</span>
              <span class="line-code">
                <span class="indent">        </span>
                ${bcSelectedBlock 
                  ? `<span class="inserted-block ${bcSelectedBlock}">${bcSelectedBlock === 'break' ? '🛑 break' : '⏭️ continue'}</span>` 
                  : '<span class="drop-placeholder">[ 여기에 놓기 ]</span>'}
              </span>
            </div>
            <div class="bc-code-line ${bcHighlight === 3 ? 'highlight' : ''}">
              <span class="line-num">4</span>
              <span class="line-code"><span class="indent">    </span><span class="py-function">print</span>(i)</span>
            </div>
          </div>
          
          <button class="btn primary bc-run-btn" id="run-bc-experiment" ${!bcSelectedBlock || bcRunning ? 'disabled' : ''}>
            ${bcRunning ? '⏳ 실행 중...' : '▶ 실행하기'}
          </button>
        </div>
        
        <!-- 오른쪽: 결과 영역 -->
        <div class="bc-result-area">
          <div class="bc-result-header">💬 출력 결과</div>
          <pre class="bc-output ${bcOutput.length === 0 ? 'empty' : ''}">${bcOutput.length > 0 ? bcOutput.join('\n') : '(실행 대기)'}</pre>
          
          <div class="bc-var-display">
            <span class="var-label">현재 i 값:</span>
            <span class="var-value" id="bc-i-value">-</span>
          </div>
        </div>
      </div>
      
      ${bcFeedback ? `
        <div class="bc-feedback ${bcSelectedBlock}">
          <div class="feedback-icon">${bcSelectedBlock === 'break' ? '🛑' : '⏭️'}</div>
          <p>${bcFeedback}</p>
        </div>
      ` : ''}
    </div>
  </div>
`
}

// Step 4: 정리
const renderStep4Summary = () => `
  <div class="step-card summary-step">
    <div class="step-header">
      <div class="step-emoji">📌</div>
      <h2>핵심 정리</h2>
    </div>
    
    <div class="summary-cards">
      <div class="summary-card">
        <div class="summary-num">1</div>
        <div class="summary-text">
          <strong>반복문</strong>은 같은 코드를 여러 번 실행할 때 사용해요
        </div>
      </div>
      
      <div class="summary-card">
        <div class="summary-num">2</div>
        <div class="summary-text">
          <strong>for문</strong>은 횟수가 정해져 있을 때<br>
          <strong>while문</strong>은 조건이 중요할 때
        </div>
      </div>
      
      <div class="summary-card">
        <div class="summary-num">3</div>
        <div class="summary-text">
          <strong>range(n)</strong>은 0부터 n-1까지의 숫자를 만들어요
        </div>
      </div>
      
      <div class="summary-card">
        <div class="summary-num">4</div>
        <div class="summary-text">
          <strong>break</strong>는 탈출 🛑<br>
          <strong>continue</strong>는 건너뛰기 ⏭️
        </div>
      </div>
    </div>
    
    <div class="cheatsheet">
      <h4>📋 한눈에 보기</h4>
      <table class="cheat-table">
        <tr>
          <th>상황</th>
          <th>사용할 것</th>
        </tr>
        <tr>
          <td>"5번 반복해"</td>
          <td><code>for i in range(5):</code></td>
        </tr>
        <tr>
          <td>"맞출 때까지 반복해"</td>
          <td><code>while 조건:</code></td>
        </tr>
        <tr>
          <td>"여기서 멈춰!"</td>
          <td><code>break</code></td>
        </tr>
        <tr>
          <td>"이번만 건너뛰어"</td>
          <td><code>continue</code></td>
        </tr>
      </table>
    </div>
  </div>
`

// Step 5: 줄 토글 실험
const renderStep5Experiment = () => {
  // 현재까지의 출력 결과
  const outputDisplay = experimentOutput.length > 0
    ? experimentOutput.join('\n')
    : '(출력 없음)'

  return `
    <div class="step-card experiment-step">
      <div class="step-header">
        <div class="step-emoji">🔬</div>
        <h2>줄 토글 실험</h2>
      </div>

      <div class="experiment-intro">
        <p>프로그램은 여러 줄의 코드가 함께 작동합니다.<br>
        <strong>줄 하나를 꺼보면, 실행 결과가 달라집니다.</strong></p>
      </div>

      <div class="experiment-container">
        <!-- 코드 영역 -->
        <div class="experiment-code-section">
          <div class="experiment-code-header">📄 코드</div>
          <div class="experiment-code-box">
            <div class="code-line fixed ${experimentHighlight === 0 ? 'highlight' : ''}">
              <span class="line-num">1</span>
              <span class="line-content">i = <span class="py-number">0</span></span>
            </div>
            <div class="code-line fixed ${experimentHighlight === 1 ? 'highlight' : ''}">
              <span class="line-num">2</span>
              <span class="line-content"><span class="py-keyword">while</span> i < <span class="py-number">3</span>:</span>
            </div>
            <div class="code-line toggleable indented ${experimentHighlight === 2 ? 'highlight' : ''} ${!experimentLines.print ? 'disabled-line' : ''}">
              <span class="line-num">3</span>
              <label class="toggle-checkbox">
                <input type="checkbox" id="toggle-print" ${experimentLines.print ? 'checked' : ''}>
                <span class="checkmark"></span>
              </label>
              <span class="line-content"><span class="indent">    </span><span class="py-function">print</span>(i)</span>
            </div>
            <div class="code-line toggleable indented ${experimentHighlight === 3 ? 'highlight' : ''} ${!experimentLines.increment ? 'disabled-line' : ''}">
              <span class="line-num">4</span>
              <label class="toggle-checkbox">
                <input type="checkbox" id="toggle-increment" ${experimentLines.increment ? 'checked' : ''}>
                <span class="checkmark"></span>
              </label>
              <span class="line-content"><span class="indent">    </span>i += <span class="py-number">1</span></span>
            </div>
          </div>

          <button class="btn primary experiment-run-btn" id="run-experiment" ${experimentRunning ? 'disabled' : ''}>
            ${experimentRunning ? '⏳ 실행 중...' : '▶ 실행'}
          </button>
        </div>

        <!-- 실행 결과 영역 -->
        <div class="experiment-result-section">
          <div class="experiment-result-header">💬 출력 결과</div>
          <pre class="experiment-output ${experimentOutput.length === 0 ? 'empty' : ''}">${outputDisplay}</pre>

          <div class="experiment-var-display">
            <span class="var-label">변수 i 값:</span>
            <span class="var-value" id="experiment-i-value">0</span>
          </div>
        </div>
      </div>

      ${experimentOutput.length > 0 || experimentRunning === false && experimentStep > 0 ? `
        <div class="experiment-reflection">
          <div class="reflection-icon">🤔</div>
          <p><strong>어떤 코드 줄이 실행 결과에 가장 큰 영향을 주었나요?</strong></p>
          <p class="reflection-hint">이 질문에 정답은 없어요. 여러분의 관찰과 생각이 중요합니다!</p>
        </div>
      ` : ''}

      <div class="experiment-tips">
        <div class="tip-icon">💡</div>
        <div class="tip-text">
          <strong>실험 아이디어:</strong> 체크박스를 끄고 켜면서 결과가 어떻게 달라지는지 관찰해보세요!<br>
          <span class="tip-warning">⚠️ i += 1을 끄면 무한 반복이 될 수 있어요! (자동으로 5회에서 멈춥니다)</span>
        </div>
      </div>
    </div>
  `
}

// Step 6: 퀴즈
const renderStep6Quiz = () => `
  <div class="step-card quiz-step">
    <div class="step-header">
      <div class="step-emoji">✅</div>
      <h2>개념 확인 퀴즈</h2>
    </div>
    
    <p class="quiz-intro">배운 내용을 확인해볼까요? 🎯</p>
    
    <div class="quiz-container">
      <div class="quiz-card" id="quiz-1">
        <div class="quiz-number">Q1</div>
        <div class="quiz-question">
          "사용자가 '종료'를 입력할 때까지 반복"하려면?
        </div>
        <div class="quiz-options">
          <button class="quiz-option" data-quiz="1" data-answer="a" data-correct="false">
            A. for문
          </button>
          <button class="quiz-option" data-quiz="1" data-answer="b" data-correct="true">
            B. while문
          </button>
        </div>
        <div class="quiz-feedback" id="feedback-1"></div>
      </div>

      <div class="quiz-card" id="quiz-2">
        <div class="quiz-number">Q2</div>
        <div class="quiz-question">
          break와 continue 중, 반복문을 완전히 종료하는 것은?
        </div>
        <div class="quiz-options">
          <button class="quiz-option" data-quiz="2" data-answer="a" data-correct="true">
            A. break
          </button>
          <button class="quiz-option" data-quiz="2" data-answer="b" data-correct="false">
            B. continue
          </button>
        </div>
        <div class="quiz-feedback" id="feedback-2"></div>
      </div>

      <div class="quiz-card" id="quiz-3">
        <div class="quiz-number">Q3</div>
        <div class="quiz-question">
          <code>range(3)</code>이 만드는 값은?
        </div>
        <div class="quiz-options">
          <button class="quiz-option" data-quiz="3" data-answer="a" data-correct="false">
            A. 1, 2, 3
          </button>
          <button class="quiz-option" data-quiz="3" data-answer="b" data-correct="true">
            B. 0, 1, 2
          </button>
          <button class="quiz-option" data-quiz="3" data-answer="c" data-correct="false">
            C. 0, 1, 2, 3
          </button>
        </div>
        <div class="quiz-feedback" id="feedback-3"></div>
      </div>
    </div>

    <div class="quiz-summary">
      <div id="quiz-score-text">지금까지 맞힌 개수: 0 / 3</div>
      <div id="quiz-score-message">문제를 풀면서 개념을 정리해 보세요.</div>
      <button class="btn primary" id="quiz-submit-btn" style="margin-top: 1rem; display: none;">
        📤 퀴즈 제출하기
      </button>
    </div>
  </div>
`

// ============================================
// 🎨 Python 문법 하이라이팅
// ============================================

const highlightPython = (code) => {
  // HTML 특수문자 이스케이프
  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // 문자열 (먼저 처리해서 내부 키워드 보호)
  highlighted = highlighted.replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, '<span class="py-string">$&</span>')
  
  // f-string
  highlighted = highlighted.replace(/f(["'])(?:(?!\1|\\).|\\.)*\1/g, '<span class="py-fstring">$&</span>')
  
  // 주석
  highlighted = highlighted.replace(/(#.*)$/gm, '<span class="py-comment">$1</span>')
  
  // 키워드
  const keywords = ['for', 'in', 'range', 'if', 'elif', 'else', 'while', 'def', 'return', 'import', 'from', 'as', 'True', 'False', 'None', 'and', 'or', 'not', 'break', 'continue', 'pass', 'print', 'input', 'len', 'int', 'str', 'float', 'list']
  for (const kw of keywords) {
    const regex = new RegExp(`\\b(${kw})\\b(?![^<]*>)`, 'g')
    highlighted = highlighted.replace(regex, '<span class="py-keyword">$1</span>')
  }
  
  // 숫자
  highlighted = highlighted.replace(/\b(\d+)\b(?![^<]*>)/g, '<span class="py-number">$1</span>')
  
  // 함수 호출 (괄호 앞)
  highlighted = highlighted.replace(/\b([a-zA-Z_]\w*)\s*\((?![^<]*>)/g, '<span class="py-function">$1</span>(')
  
  return highlighted
}

// ============================================
// 🎯 Fake Interpreter (순서도 없이 실행 단계 시각화)
// ============================================

const fakeInterpreter = (code) => {
  const lines = code.split('\n')
  const trace = []
  let stepNum = 0
  let variables = {}
  let outputs = []
  
  // 코드 라인 파싱
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const trimmed = line.trim()
    const lineNum = lineIdx + 1
    
    if (!trimmed || trimmed.startsWith('#')) continue
    
    // for i in range(n) 감지
    const forMatch = trimmed.match(/^for\s+(\w+)\s+in\s+range\((\d+)(?:,\s*(\d+))?\)/)
    if (forMatch) {
      const varName = forMatch[1]
      const start = forMatch[3] ? parseInt(forMatch[2]) : 0
      const end = forMatch[3] ? parseInt(forMatch[3]) : parseInt(forMatch[2])
      
      // for 루프 본문 찾기
      const bodyLines = []
      let j = lineIdx + 1
      const forIndent = line.length - line.trimStart().length
      
      while (j < lines.length) {
        const bodyLine = lines[j]
        const bodyTrimmed = bodyLine.trim()
        if (!bodyTrimmed) { j++; continue }
        
        const bodyIndent = bodyLine.length - bodyLine.trimStart().length
        if (bodyIndent <= forIndent) break
        
        bodyLines.push({ lineNum: j + 1, content: bodyTrimmed })
        j++
      }
      
      // 각 반복 실행
      for (let i = start; i < end; i++) {
        const iterationNum = i - start + 1
        variables[varName] = i
        
        // for 문 실행 단계
        stepNum++
        trace.push({
          step: stepNum,
          lineNum: lineNum,
          code: trimmed,
          variables: { ...variables },
          output: null,
          iteration: iterationNum,
          totalIterations: end - start,
          type: 'for',
          description: `🔄 ${iterationNum}번째 반복 시작 (${varName} = ${i})`
        })
        
        // 본문 실행
        for (const bodyItem of bodyLines) {
          // 중첩 for문 처리
          const nestedForMatch = bodyItem.content.match(/^for\s+(\w+)\s+in\s+range\((\d+)(?:,\s*(\d+))?\)/)
          if (nestedForMatch) {
            const nestedVarName = nestedForMatch[1]
            const nestedStart = nestedForMatch[3] ? parseInt(nestedForMatch[2]) : 0
            const nestedEnd = nestedForMatch[3] ? parseInt(nestedForMatch[3]) : parseInt(nestedForMatch[2])
            
            // 중첩 for문의 본문 찾기
            const nestedBodyLines = []
            // bodyItem.lineNum은 1-based이므로 0-based 인덱스로 변환
            const nestedForLineIdx = bodyItem.lineNum - 1
            if (nestedForLineIdx >= lines.length) continue
            
            const nestedForLine = lines[nestedForLineIdx]
            const nestedForIndent = nestedForLine.length - nestedForLine.trimStart().length
            
            let nestedJ = nestedForLineIdx + 1
            while (nestedJ < lines.length) {
              const nestedBodyLine = lines[nestedJ]
              const nestedBodyTrimmed = nestedBodyLine.trim()
              if (!nestedBodyTrimmed) { nestedJ++; continue }
              
              const nestedBodyIndent = nestedBodyLine.length - nestedBodyLine.trimStart().length
              // 중첩 for문과 같은 들여쓰기거나 더 작으면 중첩 for문의 본문이 아님
              if (nestedBodyIndent <= nestedForIndent) break
              
              nestedBodyLines.push({ lineNum: nestedJ + 1, content: nestedBodyTrimmed })
              nestedJ++
            }
            
            // 중첩 for문 실행
            for (let nestedI = nestedStart; nestedI < nestedEnd; nestedI++) {
              const nestedIterationNum = nestedI - nestedStart + 1
              variables[nestedVarName] = nestedI
              
              // 중첩 for문 시작
              stepNum++
              trace.push({
                step: stepNum,
                lineNum: bodyItem.lineNum,
                code: bodyItem.content,
                variables: { ...variables },
                output: null,
                iteration: nestedIterationNum,
                totalIterations: nestedEnd - nestedStart,
                type: 'for',
                description: `🔄 ${nestedIterationNum}번째 반복 시작 (${nestedVarName} = ${nestedI})`
              })
              
              // 중첩 for문 본문 실행
              for (const nestedBodyItem of nestedBodyLines) {
                stepNum++
                let output = null
                
                // print 문 처리
                const nestedPrintMatch = nestedBodyItem.content.match(/^print\((.+)\)$/)
                if (nestedPrintMatch) {
                  let printContent = nestedPrintMatch[1]
                  let endChar = '\n'
                  let sepChar = ' '
                  
                  const endMatch = printContent.match(/,\s*end\s*=\s*["'](.*)["']/)
                  if (endMatch) {
                    endChar = endMatch[1]
                    printContent = printContent.replace(/,\s*end\s*=\s*["'].*["']/, '')
                  }
                  
                  const sepMatch = printContent.match(/,\s*sep\s*=\s*["'](.*)["']/)
                  if (sepMatch) {
                    sepChar = sepMatch[1]
                    printContent = printContent.replace(/,\s*sep\s*=\s*["'].*["']/, '')
                  }
                  
                  const args = printContent.split(/,\s*(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/).filter(a => a.trim())
                  let outputParts = []
                  
                  for (let arg of args) {
                    arg = arg.trim()
                    
                    // 변수 치환 (i, j 모두 포함)
                    for (const [vName, vVal] of Object.entries(variables)) {
                      const regex = new RegExp(`\\b${vName}\\b`, 'g')
                      arg = arg.replace(regex, vVal)
                    }
                    
                    try {
                      if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                        outputParts.push(arg.slice(1, -1))
                      } else {
                        outputParts.push(eval(arg))
                      }
                    } catch {
                      outputParts.push(arg)
                    }
                  }
                  
                  output = outputParts.join(sepChar)
                  outputs.push({ text: String(output), endChar: endChar })
                }
                
                // 변수 할당 처리
                let currentEndChar = '\n'
                const nestedAssignMatch = nestedBodyItem.content.match(/^(\w+)\s*=\s*(.+)$/)
                if (nestedAssignMatch && !nestedBodyItem.content.includes('print')) {
                  const vName = nestedAssignMatch[1]
                  let vValue = nestedAssignMatch[2]
                  
                  for (const [n, v] of Object.entries(variables)) {
                    const regex = new RegExp(`\\b${n}\\b`, 'g')
                    vValue = vValue.replace(regex, v)
                  }
                  
                  try {
                    variables[vName] = eval(vValue)
                  } catch {
                    variables[vName] = vValue
                  }
                }
                
                if (nestedPrintMatch) {
                  const endMatch = nestedBodyItem.content.match(/end\s*=\s*["'](.*)["']/)
                  currentEndChar = endMatch ? endMatch[1] : '\n'
                }
                
                trace.push({
                  step: stepNum,
                  lineNum: nestedBodyItem.lineNum,
                  code: nestedBodyItem.content,
                  variables: { ...variables },
                  output: output,
                  endChar: currentEndChar,
                  iteration: nestedIterationNum,
                  totalIterations: nestedEnd - nestedStart,
                  type: output !== null ? 'print' : 'statement',
                  description: output !== null ? `💬 "${output}" 출력` : `📝 코드 실행`
                })
              }
              
              // 중첩 for문 종료
              stepNum++
              trace.push({
                step: stepNum,
                lineNum: bodyItem.lineNum,
                code: bodyItem.content,
                variables: { ...variables },
                output: null,
                iteration: nestedEnd - nestedStart,
                totalIterations: nestedEnd - nestedStart,
                type: 'for-end',
                description: `✅ 중첩 반복 완료! (${nestedVarName} = ${nestedI})`
              })
            }
            
            continue
          }
          
          stepNum++
          let output = null
          
          // print 문 처리 (end 파라미터 지원)
          const printMatch = bodyItem.content.match(/^print\((.+)\)$/)
          if (printMatch) {
            let printContent = printMatch[1]
            let endChar = '\n' // 기본값
            let sepChar = ' '  // 기본값
            
            // end= 파라미터 추출
            const endMatch = printContent.match(/,\s*end\s*=\s*["'](.*)["']/)
            if (endMatch) {
              endChar = endMatch[1]
              printContent = printContent.replace(/,\s*end\s*=\s*["'].*["']/, '')
            }
            
            // sep= 파라미터 추출
            const sepMatch = printContent.match(/,\s*sep\s*=\s*["'](.*)["']/)
            if (sepMatch) {
              sepChar = sepMatch[1]
              printContent = printContent.replace(/,\s*sep\s*=\s*["'].*["']/, '')
            }
            
            // 여러 인자 처리 (쉼표로 분리)
            const args = printContent.split(/,\s*(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/).filter(a => a.trim())
            let outputParts = []
            
            for (let arg of args) {
              arg = arg.trim()
              
              // 변수 치환
              for (const [vName, vVal] of Object.entries(variables)) {
                const regex = new RegExp(`\\b${vName}\\b`, 'g')
                arg = arg.replace(regex, vVal)
              }
              
              // f-string 처리
              arg = arg.replace(/f["'](.+)["']/, (match, str) => {
                return str.replace(/\{(\w+)\}/g, (m, v) => variables[v] !== undefined ? variables[v] : m)
              })
              
              // 따옴표 제거 및 평가
              try {
                if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                  outputParts.push(arg.slice(1, -1))
                } else {
                  outputParts.push(eval(arg))
                }
              } catch {
                outputParts.push(arg)
              }
            }
            
            output = outputParts.join(sepChar)
            outputs.push({ text: String(output), endChar: endChar })
          }
          
          // 변수 할당 처리
          let currentEndChar = '\n'
          const assignMatch = bodyItem.content.match(/^(\w+)\s*=\s*(.+)$/)
          if (assignMatch && !bodyItem.content.includes('print')) {
            const vName = assignMatch[1]
            let vValue = assignMatch[2]
            
            // 변수 치환 후 평가
            for (const [n, v] of Object.entries(variables)) {
              const regex = new RegExp(`\\b${n}\\b`, 'g')
              vValue = vValue.replace(regex, v)
            }
            
            try {
              variables[vName] = eval(vValue)
            } catch {
              variables[vName] = vValue
            }
          }
          
          // endChar 저장 (print인 경우)
          if (printMatch) {
            const endMatch = bodyItem.content.match(/end\s*=\s*["'](.*)["']/)
            currentEndChar = endMatch ? endMatch[1] : '\n'
          }
          
          trace.push({
            step: stepNum,
            lineNum: bodyItem.lineNum,
            code: bodyItem.content,
            variables: { ...variables },
            output: output,
            endChar: currentEndChar,
            iteration: iterationNum,
            totalIterations: end - start,
            type: output !== null ? 'print' : 'statement',
            description: output !== null ? `💬 "${output}" 출력` : `📝 코드 실행`
          })
        }
      }
      
      // for 루프 종료
      stepNum++
      trace.push({
        step: stepNum,
        lineNum: lineNum,
        code: trimmed,
        variables: { ...variables },
        output: null,
        iteration: end - start,
        totalIterations: end - start,
        type: 'for-end',
        description: `✅ 반복 완료! (총 ${end - start}번 반복됨)`
      })
      
      lineIdx = j - 1 // 본문 건너뛰기
      continue
    }
    
    // while 조건문 감지
    const whileMatch = trimmed.match(/^while\s+(.+):$/)
    if (whileMatch) {
      const condition = whileMatch[1].trim()
      
      // while 루프 본문 찾기
      const bodyLines = []
      let j = lineIdx + 1
      const whileIndent = line.length - line.trimStart().length
      
      while (j < lines.length) {
        const bodyLine = lines[j]
        const bodyTrimmed = bodyLine.trim()
        if (!bodyTrimmed) { j++; continue }
        
        const bodyIndent = bodyLine.length - bodyLine.trimStart().length
        if (bodyIndent <= whileIndent) break
        
        bodyLines.push({ lineNum: j + 1, content: bodyTrimmed })
        j++
      }
      
      // while 루프 실행 (조건이 참인 동안 반복)
      let iterationNum = 0
      const maxIterations = 1000 // 무한 루프 방지
      
      while (iterationNum < maxIterations) {
        // 조건 평가
        let conditionResult = false
        try {
          // 조건식에서 변수 치환
          let evalCondition = condition
          for (const [vName, vVal] of Object.entries(variables)) {
            const regex = new RegExp(`\\b${vName}\\b`, 'g')
            evalCondition = evalCondition.replace(regex, vVal)
          }
          conditionResult = eval(evalCondition)
        } catch {
          conditionResult = false
        }
        
        if (!conditionResult) {
          // 조건이 거짓이면 while 루프 종료
          stepNum++
          trace.push({
            step: stepNum,
            lineNum: lineNum,
            code: trimmed,
            variables: { ...variables },
            output: null,
            iteration: iterationNum,
            totalIterations: iterationNum,
            type: 'while-end',
            description: `✅ while 루프 종료 (조건: ${condition} = false)`
          })
          break
        }
        
        iterationNum++
        
        // while 문 실행 단계
        stepNum++
        trace.push({
          step: stepNum,
          lineNum: lineNum,
          code: trimmed,
          variables: { ...variables },
          output: null,
          iteration: iterationNum,
          totalIterations: null,
          type: 'while',
          description: `🔄 ${iterationNum}번째 반복 시작 (조건: ${condition} = true)`
        })
        
        // 본문 실행
        for (const bodyItem of bodyLines) {
          stepNum++
          let output = null
          
          // print 문 처리
          const printMatch = bodyItem.content.match(/^print\((.+)\)$/)
          if (printMatch) {
            let printContent = printMatch[1]
            let endChar = '\n'
            let sepChar = ' '
            
            const endMatch = printContent.match(/,\s*end\s*=\s*["'](.*)["']/)
            if (endMatch) {
              endChar = endMatch[1]
              printContent = printContent.replace(/,\s*end\s*=\s*["'].*["']/, '')
            }
            
            const sepMatch = printContent.match(/,\s*sep\s*=\s*["'](.*)["']/)
            if (sepMatch) {
              sepChar = sepMatch[1]
              printContent = printContent.replace(/,\s*sep\s*=\s*["'].*["']/, '')
            }
            
            const args = printContent.split(/,\s*(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/).filter(a => a.trim())
            let outputParts = []
            
            for (let arg of args) {
              arg = arg.trim()
              
              // 변수 치환
              for (const [vName, vVal] of Object.entries(variables)) {
                const regex = new RegExp(`\\b${vName}\\b`, 'g')
                arg = arg.replace(regex, vVal)
              }
              
              try {
                if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                  outputParts.push(arg.slice(1, -1))
                } else {
                  outputParts.push(eval(arg))
                }
              } catch {
                outputParts.push(arg)
              }
            }
            
            output = outputParts.join(sepChar)
            outputs.push({ text: String(output), endChar: endChar })
          }
          
          // 변수 할당 처리 (i+=1 같은 복합 할당 포함)
          let currentEndChar = '\n'
          const assignMatch = bodyItem.content.match(/^(\w+)\s*=\s*(.+)$/)
          const compoundAssignMatch = bodyItem.content.match(/^(\w+)\s*([+\-*/])=(.+)$/)
          
          if (compoundAssignMatch) {
            const vName = compoundAssignMatch[1]
            const op = compoundAssignMatch[2]
            let vValue = compoundAssignMatch[3]
            
            // 변수 치환
            for (const [n, v] of Object.entries(variables)) {
              const regex = new RegExp(`\\b${n}\\b`, 'g')
              vValue = vValue.replace(regex, v)
            }
            
            try {
              const currentVal = variables[vName] !== undefined ? variables[vName] : 0
              const increment = eval(vValue)
              if (op === '+') {
                variables[vName] = currentVal + increment
              } else if (op === '-') {
                variables[vName] = currentVal - increment
              } else if (op === '*') {
                variables[vName] = currentVal * increment
              } else if (op === '/') {
                variables[vName] = currentVal / increment
              }
            } catch {
              // 에러 무시
            }
          } else if (assignMatch && !bodyItem.content.includes('print')) {
            const vName = assignMatch[1]
            let vValue = assignMatch[2]
            
            // 변수 치환
            for (const [n, v] of Object.entries(variables)) {
              const regex = new RegExp(`\\b${n}\\b`, 'g')
              vValue = vValue.replace(regex, v)
            }
            
            try {
              variables[vName] = eval(vValue)
            } catch {
              variables[vName] = vValue
            }
          }
          
          if (printMatch) {
            const endMatch = bodyItem.content.match(/end\s*=\s*["'](.*)["']/)
            currentEndChar = endMatch ? endMatch[1] : '\n'
          }
          
          trace.push({
            step: stepNum,
            lineNum: bodyItem.lineNum,
            code: bodyItem.content,
            variables: { ...variables },
            output: output,
            endChar: currentEndChar,
            iteration: iterationNum,
            totalIterations: null,
            type: output !== null ? 'print' : 'statement',
            description: output !== null ? `💬 "${output}" 출력` : `📝 코드 실행`
          })
        }
      }
      
      lineIdx = j - 1 // 본문 건너뛰기
      continue
    }
    
    // 변수 할당 (while문 처리 전에 먼저 처리)
    const assignMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/)
    const compoundAssignMatch = trimmed.match(/^(\w+)\s*([+\-*/])=(.+)$/)
    
    if (compoundAssignMatch) {
      const vName = compoundAssignMatch[1]
      const op = compoundAssignMatch[2]
      let vValue = compoundAssignMatch[3]
      
      // 변수 치환
      for (const [n, v] of Object.entries(variables)) {
        const regex = new RegExp(`\\b${n}\\b`, 'g')
        vValue = vValue.replace(regex, v)
      }
      
      try {
        const currentVal = variables[vName] !== undefined ? variables[vName] : 0
        const increment = eval(vValue)
        if (op === '+') {
          variables[vName] = currentVal + increment
        } else if (op === '-') {
          variables[vName] = currentVal - increment
        } else if (op === '*') {
          variables[vName] = currentVal * increment
        } else if (op === '/') {
          variables[vName] = currentVal / increment
        }
      } catch {
        // 에러 무시
      }
      
      stepNum++
      trace.push({
        step: stepNum,
        lineNum: lineNum,
        code: trimmed,
        variables: { ...variables },
        output: null,
        iteration: null,
        totalIterations: null,
        type: 'assign',
        description: `📝 ${vName} = ${variables[vName]}`
      })
      continue
    } else if (assignMatch) {
      const vName = assignMatch[1]
      let vValue = assignMatch[2]
      
      // 변수 치환
      for (const [n, v] of Object.entries(variables)) {
        const regex = new RegExp(`\\b${n}\\b`, 'g')
        vValue = vValue.replace(regex, v)
      }
      
      try {
        variables[vName] = eval(vValue)
      } catch {
        variables[vName] = vValue
      }
      
      stepNum++
      trace.push({
        step: stepNum,
        lineNum: lineNum,
        code: trimmed,
        variables: { ...variables },
        output: null,
        iteration: null,
        totalIterations: null,
        type: 'assign',
        description: `📝 ${vName} = ${variables[vName]}`
      })
      continue
    }
    
    // 단순 print 문
    const printMatch = trimmed.match(/^print\((.+)\)$/)
    if (printMatch) {
      stepNum++
      let printContent = printMatch[1]
      let output = printContent
      
      // 따옴표 제거
      if (printContent.startsWith('"') || printContent.startsWith("'")) {
        output = printContent.slice(1, -1)
      }
      
      outputs.push(String(output))
      
      trace.push({
        step: stepNum,
        lineNum: lineNum,
        code: trimmed,
        variables: { ...variables },
        output: output,
        iteration: null,
        totalIterations: null,
        type: 'print',
        description: `💬 "${output}" 출력`
      })
      continue
    }
  }
  
  return { trace, outputs }
}

const renderPythonPage = () => {
  const isStepMode = pythonStepMode && latestTrace.length > 0
  const currentStep = latestTrace[pythonStepIndex] || null
  const isFinished = pythonStepIndex >= latestTrace.length - 1
  
  // 현재까지의 출력 (end 파라미터 고려해서 한 줄로 합침)
  const currentOutputs = []
  let currentLine = ''
  for (let i = 0; i <= pythonStepIndex && i < latestTrace.length; i++) {
    const t = latestTrace[i]
    if (t.output !== null) {
      currentLine += t.output
      if (t.endChar === '\n' || t.endChar === undefined) {
        currentOutputs.push(currentLine)
        currentLine = ''
      } else {
        currentLine += t.endChar // end=" " 등 적용
      }
    }
  }
  // 마지막에 줄바꿈 없이 끝난 경우 추가
  if (currentLine) {
    currentOutputs.push(currentLine)
  }
  
  // 실행 단계 테이블 렌더링 (현재 단계까지만!)
  const renderTraceTable = () => {
    if (!isStepMode || latestTrace.length === 0) {
      return '<p class="muted">👣 "실행하기" 버튼을 눌러 실행 단계를 확인하세요!</p>'
    }
    
    // 현재 단계까지만 보여주기
    const visibleTrace = latestTrace.slice(0, pythonStepIndex + 1)
    
    return `
      <div class="trace-table-wrap" id="trace-table-wrap">
        <table class="trace-table" id="trace-table">
          <thead>
            <tr>
              <th>단계</th>
              <th>줄</th>
              <th>반복</th>
              <th>코드</th>
              <th>변수</th>
              <th>출력</th>
            </tr>
          </thead>
          <tbody id="trace-tbody">
            ${visibleTrace.map((t, idx) => `
              <tr class="${idx === pythonStepIndex ? 'current new-row' : 'executed'} ${t.type}" data-step="${idx}">
                <td class="step-num">${t.step}</td>
                <td class="line-num">${t.lineNum}</td>
                <td class="iteration">${t.iteration !== null ? `${t.iteration}/${t.totalIterations}` : '-'}</td>
                <td class="code-cell"><code>${t.code}</code></td>
                <td class="vars-cell">${Object.entries(t.variables).map(([k,v]) => `<span class="var-chip">${k}=${v}</span>`).join(' ') || '-'}</td>
                <td class="output-cell">${t.output !== null ? `<span class="output-chip">"${t.output}"</span>` : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }
  
  return `
    <div class="page-content python-page">
      <div class="page-header">
        <div class="header-icon">🐍</div>
        <h1>반복문 실행 흐름 시각화</h1>
        <p class="header-desc">for 반복문이 어떻게 실행되는지 한 단계씩 확인해봐요! 🔄</p>
      </div>

      <section class="section trace-layout">
        <!-- 왼쪽: 코드 입력 -->
        <div class="code-section">
          <div class="section-header">
            <h3>✏️ 코드 입력</h3>
            <div class="btn-row">
              <button class="btn ghost small" id="btn-reset">📋 예제</button>
              <button class="btn primary small" id="btn-run-python">▶ 파이썬 실행</button>
              <button class="btn primary small" id="btn-step-start">👣 실행 흐름 보기</button>
            </div>
          </div>
          
          <div class="code-editor-box">
            ${!isStepMode ? `
              <div id="code-editor" style="height: 400px;"></div>
            ` : `
              <div class="code-with-lines">
                ${(pythonCode || starterCode).split('\n').map((line, idx) => {
                  const lineNum = idx + 1
                  const isActive = currentStep?.lineNum === lineNum
                  const isExecuted = latestTrace.slice(0, pythonStepIndex + 1).some(t => t.lineNum === lineNum)
                  return `
                    <div class="code-row ${isActive ? 'active' : ''} ${isExecuted && !isActive ? 'executed' : ''}">
                      <span class="line-number">${lineNum}</span>
                      <span class="line-code">${highlightPython(line) || ' '}</span>
        </div>
                  `
                }).join('')}
        </div>
            `}
          </div>
          
          ${isStepMode ? `
            <div class="step-controls">
              <div class="current-step-info">
                <div class="step-badge-big">${currentStep?.step || 0} / ${latestTrace.length}</div>
                <div class="step-description">${currentStep?.description || '준비 완료'}</div>
                ${currentStep?.iteration ? `<div class="iteration-badge">🔄 ${currentStep.iteration}번째 반복 중</div>` : ''}
          </div>
              <div class="step-buttons">
                <button class="btn ghost" id="btn-step-first" ${pythonStepIndex <= 0 ? 'disabled' : ''}>⏮️</button>
                <button class="btn ghost" id="btn-step-prev" ${pythonStepIndex <= 0 ? 'disabled' : ''}>◀️</button>
                <button class="btn primary" id="btn-step-next" ${isFinished ? 'disabled' : ''}>
                  ${isFinished ? '✅ 완료!' : '다음 ▶️'}
                </button>
                <button class="btn danger" id="btn-step-exit">✕</button>
        </div>
          </div>
          ` : ''}
        </div>
        
        <!-- 오른쪽: 실행 단계 테이블 -->
        <div class="trace-section">
          <div class="section-header">
            <h3>📊 실행 단계</h3>
            ${isStepMode ? '<span class="live-badge">LIVE</span>' : ''}
          </div>
          
          <div class="trace-table-container">
            ${renderTraceTable()}
        </div>
          
          <!-- 오류 메시지 -->
          <div class="error-section" id="error-section" style="display: none;">
            <h4>❌ 문법 오류</h4>
            <div class="error-display" id="error-display"></div>
        </div>
          
          <!-- 변수 상태 -->
          <div class="variables-section">
            <h4>📊 변수 상태</h4>
            <div class="variables-display" id="variables-display">
              ${Object.keys(currentStep?.variables || {}).length > 0
                ? Object.entries(currentStep?.variables || {}).map(([k, v]) => 
                    `<div class="var-item"><span class="var-name">${k}</span> = <span class="var-value">${v}</span></div>`
                  ).join('')
                : '<span class="muted">아직 변수가 없어요</span>'}
            </div>
          </div>
          
          <!-- 출력 결과 (trace용) -->
          <div class="output-section">
            <h4>💬 출력 결과</h4>
            <div class="output-display" id="output-display">
              ${currentOutputs.length > 0 
                ? currentOutputs.map(o => `<div class="output-line">${o}</div>`).join('') 
                : '<span class="muted">아직 출력이 없어요</span>'}
        </div>
          </div>
          
          <!-- 파이썬 실행 결과 -->
          <div class="python-run-section" id="python-run-section" style="display: none;">
            <h4>🐍 파이썬 실행 결과</h4>
            <div class="python-run-output" id="python-run-output"></div>
          </div>
        </div>
      </section>
    </div>
  `
}

// 현재 변수 상태 렌더링
const renderCurrentVars = (locals) => {
  if (!locals || Object.keys(locals).length === 0) {
    return '<p class="muted">아직 변수가 없어요</p>'
  }
  
  return Object.entries(locals)
    .map(([k, v]) => `
      <div class="var-row animated">
        <span class="var-name">🏷️ ${k}</span>
        <span class="var-value">${v}</span>
      </div>
    `).join('')
}

// 실행된 라인들 가져오기
const getExecutedLinesForPython = () => {
  const executed = []
  for (let i = 0; i <= pythonStepIndex && i < latestTrace.length; i++) {
    if (!executed.includes(latestTrace[i].line)) {
      executed.push(latestTrace[i].line)
    }
  }
  return executed
}

// 코드 하이라이트 렌더링
const renderCodeWithHighlight = (code, activeLine, executedLines = []) => {
  const lines = code.split('\n')
  return lines.map((line, idx) => {
    const lineNum = idx + 1
    const isActive = activeLine === lineNum
    const isExecuted = executedLines.includes(lineNum)
    return `
      <div class="code-line ${isActive ? 'active' : ''} ${isExecuted && !isActive ? 'executed' : ''}">
        <span class="code-lno">${lineNum.toString().padStart(2, '0')}</span>
        <span class="code-text">${line || '&nbsp;'}</span>
      </div>
    `
  }).join('')
}

// 코드를 파싱해서 블록 구조로 변환
const parseCodeToBlocks = (code) => {
  const lines = code.split('\n')
  const blocks = []
  let i = 0
  
  const getIndent = (line) => line.length - line.trimStart().length
  
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    const indent = getIndent(line)
    
    if (!trimmed || trimmed.startsWith('#')) {
      i++
      continue
    }
    
    // if-elif-else 체인 파싱
    if (trimmed.startsWith('if ')) {
      const ifChain = { type: 'if-chain', branches: [], lineStart: i + 1 }
      
      // if 브랜치
      const ifCondition = trimmed.replace(/^if\s+/, '').replace(/:$/, '')
      const ifBody = []
      const ifLineNum = i + 1
      i++
      
      // if 본문 수집
      while (i < lines.length) {
        const bodyLine = lines[i]
        const bodyTrimmed = bodyLine.trim()
        const bodyIndent = getIndent(bodyLine)
        
        if (!bodyTrimmed) { i++; continue }
        if (bodyIndent <= indent && bodyTrimmed) break
        
        ifBody.push({ line: i + 1, content: bodyTrimmed, indent: bodyIndent })
        i++
      }
      
      ifChain.branches.push({
        type: 'if',
        condition: ifCondition,
        body: ifBody,
        lineNum: ifLineNum
      })
      
      // elif/else 브랜치들 수집
      while (i < lines.length) {
        const nextLine = lines[i]
        const nextTrimmed = nextLine.trim()
        const nextIndent = getIndent(nextLine)
        
        if (!nextTrimmed) { i++; continue }
        if (nextIndent !== indent) break
        
        if (nextTrimmed.startsWith('elif ')) {
          const elifCondition = nextTrimmed.replace(/^elif\s+/, '').replace(/:$/, '')
          const elifBody = []
          const elifLineNum = i + 1
          i++
          
          while (i < lines.length) {
            const bodyLine = lines[i]
            const bodyTrimmed = bodyLine.trim()
            const bodyIndent = getIndent(bodyLine)
            
            if (!bodyTrimmed) { i++; continue }
            if (bodyIndent <= indent && bodyTrimmed) break
            
            elifBody.push({ line: i + 1, content: bodyTrimmed, indent: bodyIndent })
            i++
          }
          
          ifChain.branches.push({
            type: 'elif',
            condition: elifCondition,
            body: elifBody,
            lineNum: elifLineNum
          })
        } else if (nextTrimmed === 'else:') {
          const elseBody = []
          const elseLineNum = i + 1
          i++
          
          while (i < lines.length) {
            const bodyLine = lines[i]
            const bodyTrimmed = bodyLine.trim()
            const bodyIndent = getIndent(bodyLine)
            
            if (!bodyTrimmed) { i++; continue }
            if (bodyIndent <= indent && bodyTrimmed) break
            
            elseBody.push({ line: i + 1, content: bodyTrimmed, indent: bodyIndent })
            i++
          }
          
          ifChain.branches.push({
            type: 'else',
            body: elseBody,
            lineNum: elseLineNum
          })
          break
        } else {
          break
        }
      }
      
      blocks.push(ifChain)
    }
    // for 루프
    else if (trimmed.startsWith('for ')) {
      const condition = trimmed.replace(/^for\s+/, '').replace(/:$/, '')
      const body = []
      const lineNum = i + 1
      i++
      
      while (i < lines.length) {
        const bodyLine = lines[i]
        const bodyTrimmed = bodyLine.trim()
        const bodyIndent = getIndent(bodyLine)
        
        if (!bodyTrimmed) { i++; continue }
        if (bodyIndent <= indent && bodyTrimmed) break
        
        body.push({ line: i + 1, content: bodyTrimmed, indent: bodyIndent })
        i++
      }
      
      blocks.push({ type: 'for', condition, body, lineNum })
    }
    // while 루프
    else if (trimmed.startsWith('while ')) {
      const condition = trimmed.replace(/^while\s+/, '').replace(/:$/, '')
      const body = []
      const lineNum = i + 1
      i++
      
      while (i < lines.length) {
        const bodyLine = lines[i]
        const bodyTrimmed = bodyLine.trim()
        const bodyIndent = getIndent(bodyLine)
        
        if (!bodyTrimmed) { i++; continue }
        if (bodyIndent <= indent && bodyTrimmed) break
        
        body.push({ line: i + 1, content: bodyTrimmed, indent: bodyIndent })
        i++
      }
      
      blocks.push({ type: 'while', condition, body, lineNum })
    }
    // 함수 정의
    else if (trimmed.startsWith('def ')) {
      const funcName = trimmed.replace(/^def\s+/, '').replace(/:$/, '')
      blocks.push({ type: 'def', name: funcName, lineNum: i + 1 })
      i++
    }
    // import
    else if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      blocks.push({ type: 'import', content: trimmed, lineNum: i + 1 })
      i++
    }
    // 일반 문장
    else {
      blocks.push({ type: 'statement', content: trimmed, lineNum: i + 1 })
      i++
    }
  }
  
  return blocks
}

// 개선된 순서도 렌더링 (실제 흐름 반영)
const renderImprovedFlowchart = (code, currentLine = -1) => {
  const blocks = parseCodeToBlocks(code)
  const parts = []
  
  // 시작 노드
  parts.push(`
    <div class="flow-node-wrapper">
      <div class="flow-node ellipse start">🚀 시작</div>
    </div>
    <div class="flow-arrow-down">↓</div>
  `)
  
  const renderStatementNode = (content, lineNum, isBody = false) => {
    const isActive = currentLine === lineNum
    const activeClass = isActive ? 'active' : ''
    const shortContent = content.length > 25 ? content.substring(0, 25) + '...' : content
    
    if (content.includes('print(')) {
      const match = content.match(/print\((.+)\)/)
      const label = match ? match[1].substring(0, 20) : 'print'
      return `
        <div class="flow-node-wrapper ${isBody ? 'body-node' : ''}">
          <div class="flow-node parallelogram output ${activeClass}">
            <span>💬 ${label}</span>
          </div>
        </div>
      `
    } else if (content.includes('input(')) {
      return `
        <div class="flow-node-wrapper ${isBody ? 'body-node' : ''}">
          <div class="flow-node parallelogram input ${activeClass}">
            <span>⌨️ 입력</span>
          </div>
        </div>
      `
    } else if (content.includes('=') && !content.includes('==')) {
      return `
        <div class="flow-node-wrapper ${isBody ? 'body-node' : ''}">
          <div class="flow-node rect process ${activeClass}">
            <span>📝 ${shortContent}</span>
          </div>
        </div>
      `
    } else if (content.startsWith('return')) {
      return `
        <div class="flow-node-wrapper ${isBody ? 'body-node' : ''}">
          <div class="flow-node ellipse return ${activeClass}">
            <span>↩️ ${shortContent}</span>
          </div>
        </div>
      `
    } else {
      return `
        <div class="flow-node-wrapper ${isBody ? 'body-node' : ''}">
          <div class="flow-node rect ${activeClass}">
            <span>⚙️ ${shortContent}</span>
          </div>
        </div>
      `
    }
  }
  
  blocks.forEach((block) => {
    // if-elif-else 체인
    if (block.type === 'if-chain') {
      block.branches.forEach((branch, branchIdx) => {
        const isActive = currentLine === branch.lineNum
        const activeClass = isActive ? 'active' : ''
        
        if (branch.type === 'if' || branch.type === 'elif') {
          const shortCond = branch.condition.length > 25 ? branch.condition.substring(0, 25) + '...' : branch.condition
          
          // 마름모 조건
          parts.push(`
            <div class="flow-node-wrapper">
              <div class="flow-node diamond ${activeClass}">
                <div class="diamond-content">
                  <span class="flow-label">${shortCond}</span>
                </div>
              </div>
            </div>
          `)
          
          // 분기 (참/거짓)
          parts.push(`
            <div class="flow-branch-box">
              <div class="branch-left">
                <div class="branch-line-h left"></div>
                <div class="branch-label true">참 ✓</div>
                <div class="branch-line-v"></div>
                <div class="branch-content">
                  ${branch.body.map(b => renderStatementNode(b.content, b.line, true)).join('')}
                </div>
                <div class="branch-line-v"></div>
                <div class="branch-to-end">↓ 끝으로</div>
              </div>
              <div class="branch-center-line"></div>
              <div class="branch-right">
                <div class="branch-line-h right"></div>
                <div class="branch-label false">거짓 ✗</div>
                <div class="branch-line-v"></div>
              </div>
            </div>
          `)
          
        } else if (branch.type === 'else') {
          // else 블록
          parts.push(`
            <div class="flow-node-wrapper">
              <div class="flow-node else-box ${currentLine === branch.lineNum ? 'active' : ''}">
                <span>그 외</span>
              </div>
            </div>
            <div class="flow-arrow-down">↓</div>
            <div class="flow-node-wrapper">
              <div class="else-content">
                ${branch.body.map(b => renderStatementNode(b.content, b.line, true)).join('')}
              </div>
            </div>
            <div class="flow-arrow-down">↓</div>
          `)
        }
      })
      
      // 합류점
      parts.push(`
        <div class="flow-merge">
          <div class="merge-dot">●</div>
        </div>
        <div class="flow-arrow-down">↓</div>
      `)
    }
    // for 루프
    else if (block.type === 'for') {
      const isActive = currentLine === block.lineNum
      const activeClass = isActive ? 'active' : ''
      const shortCond = block.condition.length > 25 ? block.condition.substring(0, 25) + '...' : block.condition
      
      parts.push(`
        <div class="flow-node-wrapper">
          <div class="flow-node diamond loop ${activeClass}">
            <div class="diamond-content">
              <span class="flow-label">${shortCond}</span>
            </div>
          </div>
        </div>
        <div class="flow-branch-box loop-box">
          <div class="branch-left">
            <div class="branch-line-h left"></div>
            <div class="branch-label loop">반복 ↻</div>
            <div class="branch-line-v"></div>
            <div class="branch-content">
              ${block.body.map(b => renderStatementNode(b.content, b.line, true)).join('')}
            </div>
            <div class="branch-line-v"></div>
            <div class="loop-back">↑ 조건으로</div>
          </div>
          <div class="branch-center-line"></div>
          <div class="branch-right">
            <div class="branch-line-h right"></div>
            <div class="branch-label false">종료 →</div>
            <div class="branch-line-v short"></div>
          </div>
        </div>
        <div class="flow-arrow-down">↓</div>
      `)
    }
    // while 루프
    else if (block.type === 'while') {
      const isActive = currentLine === block.lineNum
      const activeClass = isActive ? 'active' : ''
      const shortCond = block.condition.length > 25 ? block.condition.substring(0, 25) + '...' : block.condition
      
      parts.push(`
        <div class="flow-node-wrapper">
          <div class="flow-node diamond loop ${activeClass}">
            <div class="diamond-content">
              <span class="flow-label">${shortCond}</span>
            </div>
          </div>
        </div>
        <div class="flow-branch-box loop-box">
          <div class="branch-left">
            <div class="branch-line-h left"></div>
            <div class="branch-label loop">참 ↻</div>
            <div class="branch-line-v"></div>
            <div class="branch-content">
              ${block.body.map(b => renderStatementNode(b.content, b.line, true)).join('')}
            </div>
            <div class="branch-line-v"></div>
            <div class="loop-back">↑ 조건으로</div>
          </div>
          <div class="branch-center-line"></div>
          <div class="branch-right">
            <div class="branch-line-h right"></div>
            <div class="branch-label false">거짓 →</div>
            <div class="branch-line-v short"></div>
          </div>
        </div>
        <div class="flow-arrow-down">↓</div>
      `)
    }
    // 함수 정의
    else if (block.type === 'def') {
      const isActive = currentLine === block.lineNum
      parts.push(`
        <div class="flow-node-wrapper">
          <div class="flow-node subroutine ${isActive ? 'active' : ''}">
            <span>📦 함수: ${block.name}</span>
          </div>
        </div>
        <div class="flow-arrow-down">↓</div>
      `)
    }
    // import
    else if (block.type === 'import') {
      const isActive = currentLine === block.lineNum
      parts.push(`
        <div class="flow-node-wrapper">
          <div class="flow-node rect import ${isActive ? 'active' : ''}">
            <span>📥 ${block.content}</span>
          </div>
        </div>
        <div class="flow-arrow-down">↓</div>
      `)
    }
    // 일반 문장
    else if (block.type === 'statement') {
      parts.push(renderStatementNode(block.content, block.lineNum))
      parts.push('<div class="flow-arrow-down">↓</div>')
    }
  })
  
  // 끝 노드
  parts.push(`
    <div class="flow-node-wrapper">
      <div class="flow-node ellipse end">🏁 끝</div>
    </div>
  `)
  
  return parts.join('')
}

// 프로젝트별 예제 코드
const projectCodes = {
  dice: `# 🎲 주사위 게임
import random

print("🎲 주사위를 굴립니다!")
result = random.randint(1, 6)
print(f"결과: {result}")

if result == 6:
    print("🎉 대박! 6이 나왔어요!")
elif result >= 4:
    print("👍 좋은 숫자예요!")
else:
    print("😅 다음엔 더 좋은 숫자가!")`,

  calc: `# 🧮 간단 계산기
def add(a, b):
    return a + b

def subtract(a, b):
    return a - b

def multiply(a, b):
    return a * b

def divide(a, b):
    if b == 0:
        return "0으로 나눌 수 없어요!"
    return a / b

# 계산해보기
print(f"5 + 3 = {add(5, 3)}")
print(f"10 - 4 = {subtract(10, 4)}")
print(f"6 × 7 = {multiply(6, 7)}")
print(f"20 ÷ 4 = {divide(20, 4)}")`,

  guess: `# 🔮 숫자 맞추기 게임 (시뮬레이션)
import random

secret = random.randint(1, 10)
guesses = [3, 7, 5]

print("🔮 1~10 사이의 숫자를 맞춰보세요!")
print(f"(정답: {secret})")
print()

for i, guess in enumerate(guesses, 1):
    print(f"시도 {i}: {guess}")
    if guess == secret:
        print("🎉 정답입니다!")
        break
    elif guess < secret:
        print("📈 더 큰 숫자예요!")
    else:
        print("📉 더 작은 숫자예요!")`,

  todo: `# 📝 할 일 목록
todos = []

def add_todo(task):
    todos.append({"task": task, "done": False})
    print(f"✅ '{task}' 추가됨!")

def show_todos():
    print("\\n📋 할 일 목록:")
    for i, todo in enumerate(todos):
        status = "✅" if todo["done"] else "⬜"
        print(f"  {i+1}. {status} {todo['task']}")

add_todo("파이썬 공부하기")
add_todo("숙제하기")
add_todo("운동하기")
show_todos()`,

  turtle: `# 🐢 거북이 그림 그리기 (시뮬레이션)
commands = []

def forward(distance):
    commands.append(f"→ {distance}픽셀 전진")

def right(angle):
    commands.append(f"↻ {angle}도 오른쪽 회전")

print("🐢 거북이가 정사각형을 그려요!")
for i in range(4):
    forward(100)
    right(90)

print("\\n거북이의 움직임:")
for cmd in commands:
    print(f"  {cmd}")`,

  rps: `# 🎮 가위바위보 게임
import random

choices = ["가위", "바위", "보"]
emojis = {"가위": "✌️", "바위": "✊", "보": "🖐️"}

def play(player_choice):
    computer = random.choice(choices)
    print(f"나: {emojis[player_choice]} {player_choice}")
    print(f"컴퓨터: {emojis[computer]} {computer}")
    
    if player_choice == computer:
        return "무승부! 🤝"
    elif (player_choice == "가위" and computer == "보") or \\
         (player_choice == "바위" and computer == "가위") or \\
         (player_choice == "보" and computer == "바위"):
        return "이겼어요! 🎉"
    else:
        return "졌어요! 😅"

print("🎮 가위바위보 게임!\\n")
for choice in ["가위", "바위", "보"]:
    result = play(choice)
    print(f"결과: {result}\\n")`
}

// ============================================
// ✏️ 프로그래밍 문제 페이지
// ============================================

// ============================================
// ✏️ 문제 페이지 (Practice) - 학습 경로형 구조
// ============================================

// 문제 데이터 정의
const practiceProblems = {
  beginner: [
    {
      id: 'b1',
      title: '1부터 10까지 출력',
      description: 'for문을 사용해서 1부터 10까지 숫자를 출력해보세요.',
      hint: 'range(1, 11)을 사용하면 1부터 10까지의 숫자를 얻을 수 있어요.',
      concepts: ['for', 'range'],
      time: '5분',
      skeleton: '# 1부터 10까지 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        requiredKeywords: ['for', 'range'],
        expectedIterations: 10
      }
    },
    {
      id: 'b2',
      title: '구구단 5단 출력',
      description: 'for문을 사용해서 구구단 5단을 출력해보세요. (5 x 1 = 5 형식)',
      hint: 'f-string을 사용하면 출력 형식을 쉽게 만들 수 있어요. 예: f"5 x {i} = {5*i}"',
      concepts: ['for', 'range'],
      time: '7분',
      skeleton: '# 구구단 5단 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['5 x 1 = 5', '5 x 2 = 10', '5 x 3 = 15', '5 x 4 = 20', '5 x 5 = 25', '5 x 6 = 30', '5 x 7 = 35', '5 x 8 = 40', '5 x 9 = 45'],
        requiredKeywords: ['for', 'range'],
        expectedIterations: 9
      }
    },
    {
      id: 'b3',
      title: '별 5개 출력',
      description: 'for문을 사용해서 별(*) 5개를 한 줄에 출력해보세요.',
      hint: 'print("*", end="")를 사용하면 줄바꿈 없이 출력할 수 있어요.',
      concepts: ['for', 'range'],
      time: '5분',
      skeleton: '# 별 5개 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['*****'],
        requiredKeywords: ['for', 'range'],
        expectedIterations: 5
      }
    }
  ],
  intermediate: [
    {
      id: 'i1',
      title: '1부터 100까지 합',
      description: 'for문을 사용해서 1부터 100까지의 합을 구하고 출력해보세요.',
      hint: '합계를 저장할 변수를 만들고, 반복문 안에서 누적해보세요.',
      concepts: ['for', 'range', 'if'],
      time: '10분',
      skeleton: '# 1부터 100까지 합 구하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['5050'],
        requiredKeywords: ['for', 'range'],
        expectedIterations: 100
      }
    },
    {
      id: 'i2',
      title: '짝수만 출력',
      description: '1부터 20까지의 숫자 중 짝수만 출력해보세요.',
      hint: 'if문과 나머지 연산자(%)를 사용해보세요. i % 2 == 0이면 짝수예요.',
      concepts: ['for', 'range', 'if'],
      time: '8분',
      skeleton: '# 1부터 20까지 짝수만 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['2', '4', '6', '8', '10', '12', '14', '16', '18', '20'],
        requiredKeywords: ['for', 'range', 'if'],
        expectedIterations: 20
      }
    },
    {
      id: 'i3',
      title: '역순 출력',
      description: '10부터 1까지 거꾸로 출력해보세요.',
      hint: 'range(10, 0, -1)을 사용하면 10부터 1까지 역순으로 반복할 수 있어요.',
      concepts: ['for', 'range'],
      time: '7분',
      skeleton: '# 10부터 1까지 역순 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
        requiredKeywords: ['for', 'range'],
        expectedIterations: 10
      }
    }
  ],
  advanced: [
    {
      id: 'a1',
      title: 'break로 반복 중단',
      description: '1부터 10까지 출력하되, 5가 나오면 반복을 중단하세요.',
      hint: 'if문으로 조건을 확인하고, break를 사용하면 반복문을 즉시 종료할 수 있어요.',
      concepts: ['for', 'range', 'if', 'break'],
      time: '10분',
      skeleton: '# 5가 나오면 반복 중단하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['1', '2', '3', '4', '5'],
        requiredKeywords: ['for', 'range', 'break'],
        expectedIterations: 5,
        mustHaveBreak: true
      }
    },
    {
      id: 'a2',
      title: 'continue로 건너뛰기',
      description: '1부터 10까지 출력하되, 짝수는 건너뛰고 홀수만 출력하세요.',
      hint: 'if문으로 짝수를 확인하고, continue를 사용하면 다음 반복으로 건너뛸 수 있어요.',
      concepts: ['for', 'range', 'if', 'continue'],
      time: '10분',
      skeleton: '# 짝수는 건너뛰고 홀수만 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['1', '3', '5', '7', '9'],
        requiredKeywords: ['for', 'range', 'continue'],
        expectedIterations: 10,
        mustHaveContinue: true
      }
    },
    {
      id: 'a3',
      title: 'while 반복문',
      description: 'while문을 사용해서 1부터 5까지 출력해보세요.',
      hint: '변수를 초기화하고, while 조건을 설정한 뒤, 반복문 안에서 변수를 증가시켜야 해요.',
      concepts: ['while'],
      time: '12분',
      skeleton: '# while문으로 1부터 5까지 출력하기\n# 여기에 코드를 작성하세요\n',
      grading: {
        output: ['1', '2', '3', '4', '5'],
        requiredKeywords: ['while'],
        expectedIterations: 5
      }
    }
  ]
}

// 난이도 선택 화면 렌더링
const renderDifficultySelection = () => {
  return `
    <div class="page-content practice-page">
      <div class="page-header">
        <div class="header-icon">✏️</div>
        <h1>반복문 연습 문제</h1>
        <p class="header-desc">난이도를 선택하고 문제를 풀어보세요!</p>
      </div>

      <div class="difficulty-selection">
        <div class="difficulty-card" data-difficulty="beginner">
          <div class="difficulty-emoji">😊</div>
          <h2>초급</h2>
          <div class="difficulty-goal">
            <strong>목표:</strong> 반복문 기본 구조 이해
          </div>
          <div class="difficulty-concepts">
            <strong>개념:</strong> for, range
          </div>
        </div>

        <div class="difficulty-card" data-difficulty="intermediate">
          <div class="difficulty-emoji">🤔</div>
          <h2>중급</h2>
          <div class="difficulty-goal">
            <strong>목표:</strong> 조건에 따른 반복 제어
          </div>
          <div class="difficulty-concepts">
            <strong>개념:</strong> if + for / while
          </div>
        </div>

        <div class="difficulty-card" data-difficulty="advanced">
          <div class="difficulty-emoji">🔥</div>
          <h2>고급</h2>
          <div class="difficulty-goal">
            <strong>목표:</strong> 실행 흐름 설계
          </div>
          <div class="difficulty-concepts">
            <strong>개념:</strong> break, continue, 조건 설계
          </div>
        </div>
      </div>
    </div>
  `
}

// 문제 목록 화면 렌더링
const renderProblemList = () => {
  const problems = practiceProblems[practiceDifficulty] || []
  practiceProblemList = problems

  return `
    <div class="page-content practice-page">
      <div class="page-header">
        <button class="btn ghost back-btn" id="practice-back-difficulty">← 난이도 선택</button>
        <h1>${practiceDifficulty === 'beginner' ? '초급' : practiceDifficulty === 'intermediate' ? '중급' : '고급'} 문제</h1>
        <p class="header-desc">문제를 선택하고 실행 흐름을 탐구하며 해결해보세요!</p>
      </div>

      <div class="problem-list-grid">
        ${problems.map((problem, idx) => `
          <div class="problem-card" data-problem-index="${idx}">
            <div class="problem-number">문제 ${idx + 1}</div>
            <h3>${problem.title}</h3>
            <div class="problem-tags">
              ${problem.concepts.map(c => `<span class="concept-tag">${c}</span>`).join('')}
            </div>
            <div class="problem-meta">
              <span class="problem-time">⏱️ ${problem.time}</span>
            </div>
            <button class="btn primary problem-start-btn" data-problem-index="${idx}">문제 풀기</button>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

// 문제 해결 화면 렌더링 (3영역 구조)
const renderProblemSolving = () => {
  if (currentProblemIndex < 0 || currentProblemIndex >= practiceProblemList.length) {
    return renderProblemList()
  }

  const problem = practiceProblemList[currentProblemIndex]
  const isFirst = currentProblemIndex === 0
  const isLast = currentProblemIndex === practiceProblemList.length - 1

  return `
    <div class="page-content practice-page problem-solving-page">
      <div class="page-header">
        <button class="btn ghost back-btn" id="practice-back-list">← 문제 목록</button>
        <h1>문제 ${currentProblemIndex + 1}: ${problem.title}</h1>
        <div class="problem-nav">
          <button class="btn mini ${isFirst ? 'disabled' : ''}" id="prev-problem" ${isFirst ? 'disabled' : ''}>← 이전 문제</button>
          <span class="problem-counter">${currentProblemIndex + 1} / ${practiceProblemList.length}</span>
          <button class="btn mini ${isLast ? 'disabled' : ''}" id="next-problem" ${isLast ? 'disabled' : ''}>다음 문제 →</button>
        </div>
      </div>

      <div class="problem-solving-layout">
        <!-- 📘 문제 설명 영역 -->
        <section class="problem-description-section">
          <h2>📘 문제 설명</h2>
          <div class="problem-description-content">
            <p>${problem.description}</p>
            <button class="btn ghost hint-toggle-btn" id="hint-toggle">
              ${practiceHintVisible ? '▼ 힌트 숨기기' : '▶ 힌트 보기'}
            </button>
            ${practiceHintVisible ? `
              <div class="hint-content">
                <strong>💡 힌트:</strong>
                <p>${problem.hint}</p>
              </div>
            ` : ''}
          </div>
        </section>

        <!-- 💻 코드 작성 영역 (집중 영역) -->
        <section class="code-editor-section">
          <h2>💻 코드 작성</h2>
          <div class="code-editor-container">
            <div id="practice-code-editor" style="height: 400px; width: 100%;"></div>
          </div>
          <div class="code-actions">
            <button class="btn primary" id="practice-run-code">▶ 실행</button>
            <button class="btn secondary" id="practice-trace-code">👣 실행 흐름 보기</button>
            <button class="btn ghost" id="practice-reset-code">🔄 코드 초기화</button>
            <button class="btn success" id="practice-grade-code">📊 채점하기</button>
          </div>
        </section>

        <!-- 🔍 실행 흐름 시각화 + 실행 결과 영역 -->
        <section class="trace-visualization-section">
          <h2>🔍 실행 흐름 시각화</h2>
          <div class="trace-container">
            ${practiceTrace.length > 0 ? `
              <div class="trace-controls">
                <button class="btn mini" id="trace-first">⏮ 처음</button>
                <button class="btn mini" id="trace-prev">⏪ 이전</button>
                <span class="trace-counter">${practiceTraceIndex + 1} / ${practiceTrace.length}</span>
                <button class="btn mini" id="trace-next">다음 ⏩</button>
                <button class="btn mini" id="trace-last">끝 ⏭</button>
              </div>
              <div class="trace-content">
                <div class="code-preview-area">
                  <h4>코드 실행 상태</h4>
                  <div id="practice-code-preview" class="code-preview"></div>
                </div>
                <div class="variables-area">
                  <h4>변수 변화</h4>
                  <div id="practice-variables-display" class="variables-display"></div>
                </div>
              </div>
            ` : `
              <div class="trace-placeholder">
                <p>코드를 작성하고 "실행 흐름 보기" 버튼을 클릭하면 실행 과정이 표시됩니다.</p>
              </div>
            `}
            <div class="output-area">
              <h4>출력 결과</h4>
              <div id="practice-output-display" class="output-display"></div>
            </div>
          </div>
        </section>
      </div>

      <!-- 채점 영역 -->
      <section class="grading-section" id="grading-section" style="display: none;">
        <h2>📊 채점 결과</h2>
        <div id="grading-result"></div>
      </section>
    </div>
  `
}

// 메인 문제 페이지 렌더링
const renderPracticePage = () => {
  if (practiceDifficulty === null) {
    return renderDifficultySelection()
  } else if (currentProblemIndex < 0) {
    return renderProblemList()
  } else {
    return renderProblemSolving()
  }
}

// ============================================
// ✏️ 문제 페이지 이벤트 핸들러 및 채점 기능
// ============================================

// 실행 흐름 시각화 UI 업데이트 (문제 페이지용)
const updatePracticeTraceUI = () => {
  if (practiceTrace.length === 0) return

  const currentStep = practiceTrace[practiceTraceIndex]
  const codeLines = practiceCode.split('\n')

  // 코드 미리보기 업데이트 (하이라이트 처리)
  const codePreview = document.querySelector('#practice-code-preview')
  if (codePreview) {
    codePreview.innerHTML = codeLines.map((line, idx) => {
      const lineNum = idx + 1
      const isActive = currentStep && currentStep.lineNum === lineNum
      const isExecuted = practiceTrace.slice(0, practiceTraceIndex).some(t => t.lineNum === lineNum)
      let className = 'code-line'
      if (isActive) className += ' active'
      else if (isExecuted) className += ' executed'
      return `<div class="${className}">
        <span class="code-lno">${lineNum.toString().padStart(2, '0')}</span>
        <span class="code-text">${highlightPython(line) || '&nbsp;'}</span>
      </div>`
    }).join('')
  }

  // 변수 표시 업데이트
  const variablesDisplay = document.querySelector('#practice-variables-display')
  if (variablesDisplay) {
    const vars = currentStep?.variables || {}
    if (Object.keys(vars).length > 0) {
      variablesDisplay.innerHTML = Object.entries(vars).map(([k, v]) => 
        `<div class="var-row"><span class="var-name">${k}</span><span class="var-value">${v}</span></div>`
      ).join('')
    } else {
      variablesDisplay.innerHTML = '<p class="muted">변수 변화 없음</p>'
    }
  }

  // 출력 표시 업데이트 (현재 단계까지의 출력만)
  const outputDisplay = document.querySelector('#practice-output-display')
  if (outputDisplay) {
    let fullOutput = ''
    let currentLine = ''
    for (let i = 0; i <= practiceTraceIndex; i++) {
      const step = practiceTrace[i]
      if (step.output !== null && step.output !== undefined) {
        currentLine += step.output
        if (step.endChar === '\n' || step.endChar === undefined) {
          fullOutput += currentLine + '\n'
          currentLine = ''
        } else {
          currentLine += step.endChar
        }
      }
    }
    if (currentLine) fullOutput += currentLine
    outputDisplay.textContent = fullOutput.trim() || '(아직 출력 없음)'
  }

  // 버튼 상태 업데이트
  const firstBtn = document.querySelector('#trace-first')
  const prevBtn = document.querySelector('#trace-prev')
  const nextBtn = document.querySelector('#trace-next')
  const lastBtn = document.querySelector('#trace-last')
  const counter = document.querySelector('.trace-counter')

  const isFirst = practiceTraceIndex === 0
  const isLast = practiceTraceIndex >= practiceTrace.length - 1

  if (firstBtn) firstBtn.disabled = isFirst
  if (prevBtn) prevBtn.disabled = isFirst
  if (nextBtn) nextBtn.disabled = isLast
  if (lastBtn) lastBtn.disabled = isLast
  if (counter) counter.textContent = `${practiceTraceIndex + 1} / ${practiceTrace.length}`
}

// 자동 채점 기능
const gradePracticeCode = async (code, problem) => {
  const grading = problem.grading
  let score = 0
  let maxScore = 100
  const feedback = []

  // 1. 출력 결과 비교
  try {
    if (typeof window.Sk === 'undefined') {
      feedback.push({ type: 'error', message: '❌ Skulpt가 로드되지 않았습니다.' })
    } else {
      const Sk = window.Sk
      let output = ''
      const capturedOutput = []
      
      // Skulpt로 실행하여 출력 캡처
      Sk.configure({
        output: (text) => {
          capturedOutput.push(text)
        },
        read: (x) => {
          if (Sk.builtinFiles && Sk.builtinFiles.files && Sk.builtinFiles.files[x]) {
            return Sk.builtinFiles.files[x]
          }
          throw 'File not found: \'' + x + '\''
        }
      })

      try {
        const compiled = Sk.importMainWithBody('<stdin>', false, code)
        if (compiled && compiled.then) {
          await compiled
        }
        output = capturedOutput.join('').trim()
      } catch (err) {
        // 실행 오류 처리
        let errorMsg = ''
        if (err.traceback) {
          errorMsg = err.traceback
        } else if (err.toString) {
          errorMsg = err.toString()
        } else {
          errorMsg = String(err)
        }
        feedback.push({ type: 'error', message: `❌ 코드 실행 오류: ${errorMsg}` })
      }

      // 출력 비교
      if (grading.output && grading.output.length > 0) {
        const expectedOutput = grading.output.join('\n').trim()
        const actualOutput = output.trim()
        
        if (actualOutput === expectedOutput) {
          score += 50
          feedback.push({ type: 'success', message: '✅ 출력 결과가 정확합니다!' })
        } else if (actualOutput) {
          // 부분 일치 확인
          const expectedLines = expectedOutput.split('\n')
          const actualLines = actualOutput.split('\n')
          let matchedLines = 0
          for (let i = 0; i < Math.min(expectedLines.length, actualLines.length); i++) {
            if (expectedLines[i].trim() === actualLines[i].trim()) {
              matchedLines++
            }
          }
          if (matchedLines > 0) {
            score += Math.round((matchedLines / expectedLines.length) * 30)
            feedback.push({ 
              type: 'partial', 
              message: `⚠️ 출력 결과가 부분적으로 일치합니다. (${matchedLines}/${expectedLines.length}줄 일치)` 
            })
          } else {
            feedback.push({ 
              type: 'error', 
              message: `❌ 출력 결과가 예상과 다릅니다.\n예상: ${expectedOutput}\n실제: ${actualOutput}` 
            })
          }
        } else {
          feedback.push({ 
            type: 'error', 
            message: '❌ 출력이 없습니다. 코드가 제대로 실행되었는지 확인해주세요.' 
          })
        }
      }
    }
  } catch (err) {
    feedback.push({ type: 'error', message: `❌ 코드 실행 중 오류가 발생했습니다: ${err.message || err}` })
  }

  // 2. 문법 요소 사용 여부
  const requiredKeywords = grading.requiredKeywords || []
  let keywordScore = 0
  const keywordMaxScore = 30
  const keywordScorePerItem = keywordMaxScore / requiredKeywords.length

  requiredKeywords.forEach(keyword => {
    if (code.includes(keyword)) {
      keywordScore += keywordScorePerItem
      feedback.push({ type: 'success', message: `✅ ${keyword} 사용 확인` })
    } else {
      feedback.push({ type: 'warning', message: `⚠️ ${keyword} 사용이 필요합니다` })
    }
  })

  score += Math.round(keywordScore)

  // 3. break/continue 필수 여부
  if (grading.mustHaveBreak && !code.includes('break')) {
    feedback.push({ type: 'warning', message: '⚠️ break를 사용해야 합니다' })
    score = Math.max(0, score - 10)
  }
  if (grading.mustHaveContinue && !code.includes('continue')) {
    feedback.push({ type: 'warning', message: '⚠️ continue를 사용해야 합니다' })
    score = Math.max(0, score - 10)
  }

  // 4. 실행 흐름 기반 채점 (반복 횟수)
  if (practiceTrace.length > 0 && grading.expectedIterations) {
    const actualIterations = practiceTrace.filter(t => t.type === 'for' || t.type === 'while').length
    if (actualIterations === grading.expectedIterations) {
      score += 20
      feedback.push({ type: 'success', message: `✅ 반복 횟수가 정확합니다 (${actualIterations}회)` })
    } else {
      const iterationScore = Math.round((1 - Math.abs(actualIterations - grading.expectedIterations) / grading.expectedIterations) * 20)
      score += Math.max(0, iterationScore)
      feedback.push({ 
        type: 'partial', 
        message: `⚠️ 반복 횟수: 예상 ${grading.expectedIterations}회, 실제 ${actualIterations}회` 
      })
    }
  }

  score = Math.min(100, Math.max(0, score))

  return {
    score,
    maxScore,
    feedback,
    grade: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor'
  }
}

// 문제 페이지 이벤트 핸들러
const attachPracticeEvents = () => {
  // 난이도 선택
  const difficultyCards = document.querySelectorAll('.difficulty-card')
  difficultyCards.forEach(card => {
    card.addEventListener('click', () => {
      practiceDifficulty = card.dataset.difficulty
      currentProblemIndex = -1
      practiceCode = ''
      practiceTrace = []
      practiceTraceIndex = 0
      practiceHintVisible = false
      renderApp()
    })
  })

  // 난이도 선택으로 돌아가기
  const backDifficultyBtn = document.querySelector('#practice-back-difficulty')
  if (backDifficultyBtn) {
    backDifficultyBtn.addEventListener('click', () => {
      practiceDifficulty = null
      currentProblemIndex = -1
      practiceCode = ''
      practiceTrace = []
      practiceTraceIndex = 0
      practiceHintVisible = false
      renderApp()
    })
  }

  // 문제 목록으로 돌아가기
  const backListBtn = document.querySelector('#practice-back-list')
  if (backListBtn) {
    backListBtn.addEventListener('click', () => {
      currentProblemIndex = -1
      practiceCode = ''
      practiceTrace = []
      practiceTraceIndex = 0
      practiceHintVisible = false
      renderApp()
    })
  }

  // 문제 시작 버튼
  const problemStartBtns = document.querySelectorAll('.problem-start-btn')
  problemStartBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentProblemIndex = parseInt(btn.dataset.problemIndex)
      const problem = practiceProblemList[currentProblemIndex]
      practiceCode = problem.skeleton
      practiceTrace = []
      practiceTraceIndex = 0
      practiceHintVisible = false
      renderApp()
    })
  })

  // 이전/다음 문제 이동
  const prevProblemBtn = document.querySelector('#prev-problem')
  const nextProblemBtn = document.querySelector('#next-problem')
  
  if (prevProblemBtn) {
    prevProblemBtn.addEventListener('click', () => {
      if (currentProblemIndex > 0) {
        currentProblemIndex--
        const problem = practiceProblemList[currentProblemIndex]
        practiceCode = problem.skeleton
        practiceTrace = []
        practiceTraceIndex = 0
        practiceHintVisible = false
        renderApp()
      }
    })
  }

  if (nextProblemBtn) {
    nextProblemBtn.addEventListener('click', () => {
      if (currentProblemIndex < practiceProblemList.length - 1) {
        currentProblemIndex++
        const problem = practiceProblemList[currentProblemIndex]
        practiceCode = problem.skeleton
        practiceTrace = []
        practiceTraceIndex = 0
        practiceHintVisible = false
        renderApp()
      }
    })
  }

  // 힌트 토글
  const hintToggleBtn = document.querySelector('#hint-toggle')
  if (hintToggleBtn) {
    hintToggleBtn.addEventListener('click', () => {
      practiceHintVisible = !practiceHintVisible
      renderApp()
    })
  }

  // ACE Editor 초기화 (문제 해결 화면에서만)
  if (currentProblemIndex >= 0) {
    const editorHost = document.querySelector('#practice-code-editor')
    if (editorHost && typeof ace !== 'undefined') {
      if (!practiceEditor || practiceEditor.container !== editorHost) {
        if (practiceEditor) {
          practiceEditor.destroy()
        }
        practiceEditor = ace.edit(editorHost)
        practiceEditor.setTheme('ace/theme/monokai')
        practiceEditor.session.setMode('ace/mode/python')
        practiceEditor.setValue(practiceCode || '')
        practiceEditor.setOptions({
          fontSize: 16,
          fontFamily: 'Consolas, Monaco, monospace',
          tabSize: 4,
          useSoftTabs: true,
          wrap: true,
          showPrintMargin: false,
          readOnly: false
        })
      } else {
        practiceEditor.setValue(practiceCode || '')
      }
    }

    // trace가 있으면 UI 업데이트
    if (practiceTrace.length > 0) {
      setTimeout(() => {
        updatePracticeTraceUI()
      }, 100)
    }
  }

  // 코드 실행 버튼 (실행 결과만 표시)
  const runCodeBtn = document.querySelector('#practice-run-code')
  if (runCodeBtn) {
    runCodeBtn.addEventListener('click', () => {
      const code = practiceEditor ? practiceEditor.getValue() : (document.querySelector('#practice-code-editor textarea')?.value || '')
      practiceCode = code
      
      // 출력 영역에 상태 표시
      const outputDisplay = document.querySelector('#practice-output-display')
      if (outputDisplay) {
        outputDisplay.textContent = '실행 중...'
      }

      // Skulpt 체크
      if (typeof window.Sk === 'undefined') {
        if (outputDisplay) {
          outputDisplay.textContent = '❌ Skulpt가 로드되지 않았습니다. 페이지를 새로고침해 주세요.'
        }
        return
      }

      const Sk = window.Sk
      let outputText = ''

      Sk.configure({
        output: (text) => {
          outputText += text
        },
        read: (x) => {
          if (Sk.builtinFiles && Sk.builtinFiles.files && Sk.builtinFiles.files[x]) {
            return Sk.builtinFiles.files[x]
          }
          throw 'File not found: \'' + x + '\''
        }
      })

      try {
        const compiled = Sk.importMainWithBody('<stdin>', false, code)
        
        if (compiled && compiled.then) {
          // Promise인 경우
          compiled.then(() => {
            const displayEl = document.querySelector('#practice-output-display')
            if (displayEl) {
              if (outputText.trim()) {
                displayEl.textContent = outputText
              } else {
                displayEl.textContent = '(출력 없음)'
              }
            }
          }).catch((err) => {
            let errorMsg = ''
            if (err.traceback) {
              errorMsg = err.traceback
            } else if (err.toString) {
              errorMsg = err.toString()
            } else {
              errorMsg = String(err)
            }
            const displayEl = document.querySelector('#practice-output-display')
            if (displayEl) {
              displayEl.textContent = `오류: ${errorMsg}`
            }
          })
        } else {
          // 동기 실행인 경우
          const displayEl = document.querySelector('#practice-output-display')
          if (displayEl) {
            if (outputText.trim()) {
              displayEl.textContent = outputText
            } else {
              displayEl.textContent = '(출력 없음)'
            }
          }
        }
      } catch (err) {
        let errorMsg = ''
        if (err.traceback) {
          errorMsg = err.traceback
        } else if (err.toString) {
          errorMsg = err.toString()
        } else {
          errorMsg = String(err)
        }
        const displayEl = document.querySelector('#practice-output-display')
        if (displayEl) {
          displayEl.textContent = `오류: ${errorMsg}`
        }
      }
    })
  }

  // 실행 흐름 보기 버튼 (단계별 하이라이트)
  const traceCodeBtn = document.querySelector('#practice-trace-code')
  if (traceCodeBtn) {
    traceCodeBtn.addEventListener('click', () => {
      const code = practiceEditor ? practiceEditor.getValue() : (document.querySelector('#practice-code-editor textarea')?.value || '')
      practiceCode = code

      // 문법 검사
      const syntaxCheck = checkPythonSyntax(code)
      if (!syntaxCheck.valid) {
        alert(`문법 오류: ${syntaxCheck.error}`)
        return
      }

      // fakeInterpreter로 trace 생성
      const result = fakeInterpreter(code)
      if (result && result.trace) {
        practiceTrace = result.trace
        practiceTraceIndex = 0
        renderApp() // trace가 생성되었으므로 UI 업데이트
      }
    })
  }

  // 코드 초기화 버튼
  const resetCodeBtn = document.querySelector('#practice-reset-code')
  if (resetCodeBtn) {
    resetCodeBtn.addEventListener('click', () => {
      const problem = practiceProblemList[currentProblemIndex]
      practiceCode = problem.skeleton
      practiceTrace = []
      practiceTraceIndex = 0
      if (practiceEditor) {
        practiceEditor.setValue(practiceCode)
      }
      renderApp()
    })
  }

  // 실행 흐름 네비게이션 버튼
  const traceFirstBtn = document.querySelector('#trace-first')
  const tracePrevBtn = document.querySelector('#trace-prev')
  const traceNextBtn = document.querySelector('#trace-next')
  const traceLastBtn = document.querySelector('#trace-last')

  if (traceFirstBtn) {
    traceFirstBtn.addEventListener('click', () => {
      practiceTraceIndex = 0
      updatePracticeTraceUI()
    })
  }

  if (tracePrevBtn) {
    tracePrevBtn.addEventListener('click', () => {
      if (practiceTraceIndex > 0) {
        practiceTraceIndex--
        updatePracticeTraceUI()
      }
    })
  }

  if (traceNextBtn) {
    traceNextBtn.addEventListener('click', () => {
      if (practiceTraceIndex < practiceTrace.length - 1) {
        practiceTraceIndex++
        updatePracticeTraceUI()
      }
    })
  }

  if (traceLastBtn) {
    traceLastBtn.addEventListener('click', () => {
      practiceTraceIndex = practiceTrace.length - 1
      updatePracticeTraceUI()
    })
  }

  // 채점 버튼
  const gradeBtn = document.querySelector('#practice-grade-code')
  if (gradeBtn) {
    gradeBtn.addEventListener('click', async () => {
      const code = practiceEditor ? practiceEditor.getValue() : (document.querySelector('#practice-code-editor textarea')?.value || '')
      const problem = practiceProblemList[currentProblemIndex]
      
      if (!code || !code.trim()) {
        alert('코드를 작성해주세요!')
        return
      }

      // 문법 검사
      const syntaxCheck = checkPythonSyntax(code)
      if (!syntaxCheck.valid) {
        alert(`문법 오류: ${syntaxCheck.error}`)
        return
      }

      // 실행 흐름이 없으면 먼저 생성
      if (practiceTrace.length === 0) {
        const result = fakeInterpreter(code)
        if (result && result.trace) {
          practiceTrace = result.trace
        }
      }

      // 채점 실행
      const gradingResult = await gradePracticeCode(code, problem)
      
      // 채점 결과 표시
      const gradingSection = document.querySelector('#grading-section')
      const gradingResultEl = document.querySelector('#grading-result')
      
      if (gradingSection && gradingResultEl) {
        gradingSection.style.display = 'block'
        
        const gradeEmoji = gradingResult.grade === 'excellent' ? '🌟' : 
                          gradingResult.grade === 'good' ? '👍' : 
                          gradingResult.grade === 'fair' ? '👌' : '💪'
        
        gradingResultEl.innerHTML = `
          <div class="grading-score">
            <div class="score-display ${gradingResult.grade}">
              ${gradeEmoji} ${gradingResult.score}점 / ${gradingResult.maxScore}점
            </div>
          </div>
          <div class="grading-feedback">
            <h4>📝 상세 피드백:</h4>
            <ul class="feedback-list">
              ${gradingResult.feedback.map(f => `
                <li class="feedback-item ${f.type}">${f.message}</li>
              `).join('')}
            </ul>
          </div>
        `
        
        // 채점 결과 영역으로 스크롤
        gradingSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    })
  }
}

// ============================================
// 🎨 프로젝트 페이지 (Project)
// ============================================

// 프로젝트 상태 관리
let projectLevel = null // null, 'beginner', 'intermediate', 'advanced'
let projectCode = ''
let projectRuleExplanation = ''
let projectShowTrace = false // 실행 흐름 보기 모드
let projectTrace = []
let projectTraceIndex = 0
// 프로젝트/성찰 시간 측정
let projectStartTime = null
let projectSubmitTime = null
let reflectionStartTime = null

// 프로젝트 실행 흐름 UI만 업데이트 (새로고침 없이)
const updateProjectTraceUI = () => {
  const traceSection = document.querySelector('.project-trace-section')
  if (!traceSection || projectTrace.length === 0) return
  
  const currentStep = projectTrace[projectTraceIndex]
  const codeLines = projectCode.split('\n')
  
  // 코드 라인 업데이트
  const codeContainer = traceSection.querySelector('.trace-code-lines')
  if (codeContainer) {
    codeContainer.innerHTML = codeLines.map((line, idx) => {
      const lineNum = idx + 1
      const isActive = currentStep && currentStep.lineNum === lineNum
      const isExecuted = projectTrace.slice(0, projectTraceIndex + 1).some(t => t.lineNum === lineNum)
      let className = 'trace-code-line'
      if (isActive) className += ' active'
      else if (isExecuted) className += ' executed'
      return '<div class="' + className + '"><span class="line-num">' + lineNum + '</span><span class="line-code">' + highlightPython(line || ' ') + '</span></div>'
    }).join('')
  }
  
  // 트레이스 테이블 업데이트
  const tableBody = traceSection.querySelector('.trace-table tbody')
  if (tableBody) {
    tableBody.innerHTML = projectTrace.slice(0, projectTraceIndex + 1).map((step, idx) => {
      const isActive = idx === projectTraceIndex
      const varsHTML = Object.entries(step.variables || {}).map(([k, v]) => '<span class="var-chip">' + k + '=' + v + '</span>').join(' ')
      const outputHTML = step.output ? '<span class="output-text">' + step.output + '</span>' : '<span class="no-output">-</span>'
      return '<tr class="' + (isActive ? 'active' : '') + '"><td>' + (idx + 1) + '</td><td>' + step.lineNum + '</td><td>' + varsHTML + '</td><td>' + outputHTML + '</td></tr>'
    }).join('')
    
    // 테이블 스크롤
    const tableWrap = traceSection.querySelector('.trace-table-wrap')
    if (tableWrap) {
      tableWrap.scrollTop = tableWrap.scrollHeight
    }
  }
  
  // 출력 업데이트
  const outputPre = traceSection.querySelector('.trace-output')
  if (outputPre) {
    let fullOutput = ''
    let currentLine = ''
    for (let i = 0; i <= projectTraceIndex; i++) {
      const step = projectTrace[i]
      if (step.output) {
        currentLine += step.output
        const endChar = step.endChar !== undefined ? step.endChar : '\n'
        if (endChar === '\n') {
          fullOutput += currentLine + '\n'
          currentLine = ''
        }
      }
    }
    fullOutput += currentLine
    outputPre.textContent = fullOutput || '(아직 출력 없음)'
  }
  
  // 프로그레스 바 업데이트
  const progressFill = traceSection.querySelector('.progress-fill')
  const progressText = traceSection.querySelector('.progress-text')
  if (progressFill) {
    const progress = Math.round(((projectTraceIndex + 1) / projectTrace.length) * 100)
    progressFill.style.width = progress + '%'
  }
  if (progressText) {
    progressText.textContent = `${projectTraceIndex + 1} / ${projectTrace.length} 단계`
  }
  
  // 버튼 상태 업데이트
  const firstBtn = traceSection.querySelector('#trace-first')
  const prevBtn = traceSection.querySelector('#trace-prev')
  const nextBtn = traceSection.querySelector('#trace-next')
  const lastBtn = traceSection.querySelector('#trace-last')
  
  const isFirst = projectTraceIndex === 0
  const isLast = projectTraceIndex >= projectTrace.length - 1
  
  if (firstBtn) firstBtn.disabled = isFirst
  if (prevBtn) prevBtn.disabled = isFirst
  if (nextBtn) nextBtn.disabled = isLast
  if (lastBtn) lastBtn.disabled = isLast
}

// 프로젝트 실행 흐름 섹션 렌더링
const renderProjectTraceSection = () => {
  if (projectTrace.length === 0) return ''
  
  const currentStep = projectTrace[projectTraceIndex]
  const codeLines = projectCode.split('\n')
  
  // 코드 라인 렌더링
  const codeHTML = codeLines.map((line, idx) => {
    const lineNum = idx + 1
    const isActive = currentStep && currentStep.lineNum === lineNum
    const isExecuted = projectTrace.slice(0, projectTraceIndex + 1).some(t => t.lineNum === lineNum)
    let className = 'trace-code-line'
    if (isActive) className += ' active'
    else if (isExecuted) className += ' executed'
    return '<div class="' + className + '"><span class="line-num">' + lineNum + '</span><span class="line-code">' + highlightPython(line || ' ') + '</span></div>'
  }).join('')
  
  // 트레이스 테이블 렌더링
  const traceRows = projectTrace.slice(0, projectTraceIndex + 1).map((step, idx) => {
    const isActive = idx === projectTraceIndex
    const varsHTML = Object.entries(step.variables || {}).map(([k, v]) => '<span class="var-chip">' + k + '=' + v + '</span>').join(' ')
    const outputHTML = step.output ? '<span class="output-text">' + step.output + '</span>' : '<span class="no-output">-</span>'
    return '<tr class="' + (isActive ? 'active' : '') + '"><td>' + (idx + 1) + '</td><td>' + step.lineNum + '</td><td>' + varsHTML + '</td><td>' + outputHTML + '</td></tr>'
  }).join('')
  
  // 현재까지의 전체 출력
  let fullOutput = ''
  let currentLine = ''
  for (let i = 0; i <= projectTraceIndex; i++) {
    const step = projectTrace[i]
    if (step.output) {
      currentLine += step.output
      const endChar = step.endChar !== undefined ? step.endChar : '\n'
      if (endChar === '\n') {
        fullOutput += currentLine + '\n'
        currentLine = ''
      }
    }
  }
  fullOutput += currentLine
  
  const progress = Math.round(((projectTraceIndex + 1) / projectTrace.length) * 100)
  
  return `
    <div class="project-trace-section">
      <div class="card-label">🔍 실행 흐름 시각화</div>
      
      <div class="trace-layout">
        <!-- 왼쪽: 코드 -->
        <div class="trace-code-panel">
          <div class="panel-header">📄 코드</div>
          <div class="trace-code-lines">${codeHTML}</div>
        </div>
        
        <!-- 오른쪽: 실행 단계 -->
        <div class="trace-table-panel">
          <div class="panel-header">📊 실행 단계</div>
          <div class="trace-table-wrap">
            <table class="trace-table">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>줄</th>
                  <th>변수</th>
                  <th>출력</th>
                </tr>
              </thead>
              <tbody>${traceRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      
      <!-- 출력 결과 -->
      <div class="trace-output-section">
        <div class="panel-header">💬 출력 결과</div>
        <pre class="trace-output">${fullOutput || '(아직 출력 없음)'}</pre>
      </div>
      
      <!-- 컨트롤 -->
      <div class="trace-controls">
        <div class="trace-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <span class="progress-text">${projectTraceIndex + 1} / ${projectTrace.length} 단계</span>
        </div>
        
        <div class="trace-buttons">
          <button class="btn ghost" id="trace-first" ${projectTraceIndex === 0 ? 'disabled' : ''}>⏮ 처음</button>
          <button class="btn ghost" id="trace-prev" ${projectTraceIndex === 0 ? 'disabled' : ''}>◀ 이전</button>
          <button class="btn primary" id="trace-next" ${projectTraceIndex >= projectTrace.length - 1 ? 'disabled' : ''}>다음 ▶</button>
          <button class="btn ghost" id="trace-last" ${projectTraceIndex >= projectTrace.length - 1 ? 'disabled' : ''}>마지막 ⏭</button>
        </div>
      </div>
    </div>
  `
}

const renderProjectPage = () => {
  // 레벨 선택 전: 소개 화면
  if (!projectLevel) {
    return `
      <div class="page-content project-page">
        <div class="project-intro-screen">
          <div class="intro-icon">🚀</div>
          <h1>나도 프로그래머 – 미니 프로젝트</h1>
          
          <div class="intro-message">
            <p class="highlight-text">이 프로젝트에는 <strong>정답이 없습니다.</strong></p>
            <p>여러분이 만든 규칙이 곧 답입니다.</p>
          </div>
          
          <div class="level-selection">
            <h3>나의 수준을 선택하세요</h3>
            
            <div class="level-cards">
              <button class="level-card beginner" data-level="beginner">
                <span class="level-icon">🌱</span>
                <span class="level-name">초급</span>
                <span class="level-desc">반복문이 아직 익숙하지 않은 학생</span>
              </button>
              
              <button class="level-card intermediate" data-level="intermediate">
                <span class="level-icon">🌿</span>
                <span class="level-name">중급</span>
                <span class="level-desc">반복 조건과 제어를 설계해보고 싶은 학생</span>
              </button>
              
              <button class="level-card advanced" data-level="advanced">
                <span class="level-icon">🌳</span>
                <span class="level-name">고급</span>
                <span class="level-desc">반복문으로 규칙을 만들어보고 싶은 학생</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `
  }
  
  // 레벨별 프로젝트 콘텐츠
  const projects = {
    beginner: {
      title: '나만의 숫자 출력 규칙 만들기',
      icon: '🔢',
      mission: '반복문을 사용해<br>어떤 숫자를, 어떤 규칙으로 출력할지<br>스스로 정해 프로그램을 만들어 보세요.',
      requirements: [
        'for 또는 while 중 하나 사용',
        '반복문 1개 이상 사용',
        '규칙을 주석 또는 설명란에 명확히 작성'
      ],
      ideas: [
        '홀수만 출력하기',
        '3의 배수만 출력하기',
        '5씩 증가하는 숫자 출력하기'
      ],
      starterCode: '# 🌱 나만의 숫자 출력 규칙\\n# 아래에 나만의 규칙을 코드로 작성해보세요!\\n\\nfor i in range(1, 11):\\n    # 여기에 조건을 추가해보세요\\n    print(i)'
    },
    intermediate: {
      title: '멈추는 조건이 있는 반복 도구',
      icon: '🛑',
      mission: '숫자를 출력하다가<br>어떤 조건에서 반복을 멈출지<br>스스로 설계해 보세요.',
      requirements: [
        'while문 사용',
        'break 사용',
        '멈추는 조건을 설명란에 작성'
      ],
      ideas: [
        '특정 숫자가 되면 멈추기',
        '조건을 만족하면 멈추기',
        '일정 횟수 반복 후 멈추기'
      ],
      starterCode: '# 🌿 멈추는 조건이 있는 반복\\n# 어떤 조건에서 멈출지 직접 설계해보세요!\\n\\ni = 0\\nwhile True:\\n    i = i + 1\\n    print(i)\\n    # 여기에 break 조건을 추가해보세요\\n    # if ??? :\\n    #     break'
    },
    advanced: {
      title: '규칙 기반 출력 생성기',
      icon: '⚡',
      mission: '반복문과 조건문을 활용해<br>자신만의 출력 규칙 생성기를 만들어 보세요.',
      requirements: [
        '반복문 1개 이상',
        'continue를 의미 있게 사용할 것',
        '조건문(if) 포함'
      ],
      ideas: [
        '특정 조건을 만족하는 값만 출력',
        '조건에 따라 출력 방식이 달라지는 규칙',
        '패턴이나 간격을 만드는 규칙'
      ],
      starterCode: '# 🌳 규칙 기반 출력 생성기\\n# continue를 활용해서 나만의 규칙을 만들어보세요!\\n\\nfor i in range(1, 21):\\n    # 특정 조건에서 건너뛰기\\n    # if ??? :\\n    #     continue\\n    print(i)'
    }
  }
  
  const p = projects[projectLevel]
  const levelNames = { beginner: '🌱 초급', intermediate: '🌿 중급', advanced: '🌳 고급' }
  
  return `
    <div class="page-content project-page">
      <!-- 레벨 변경 바 -->
      <div class="level-change-bar">
        <button class="btn ghost" id="change-level">← 레벨 다시 선택</button>
        <span class="current-level">${levelNames[projectLevel]}</span>
      </div>
      
      <!-- 프로젝트 헤더 -->
      <div class="project-header">
        <span class="project-icon">${p.icon}</span>
        <h1>${p.title}</h1>
      </div>
      
      <div class="project-content">
        <!-- 미션 카드 -->
        <div class="mission-card">
          <div class="card-label">🎯 미션</div>
          <p class="mission-text">${p.mission}</p>
        </div>
        
        <!-- 필수 조건 카드 -->
        <div class="requirements-card">
          <div class="card-label">✅ 필수 조건</div>
          <ul class="requirements-list">
            ${p.requirements.map(r => '<li>' + r + '</li>').join('')}
          </ul>
        </div>
        
        <!-- 선택 아이디어 카드 -->
        <div class="ideas-card">
          <div class="card-label">💡 선택 아이디어</div>
          <p class="ideas-notice">⚠️ 아래는 예시일 뿐, 정답이 아닙니다!</p>
          <ul class="ideas-list">
            ${p.ideas.map(idea => '<li>' + idea + '</li>').join('')}
          </ul>
        </div>
        
        <!-- 코드 작성 영역 -->
        <div class="code-section">
          <div class="card-label">💻 코드 작성</div>
          <textarea id="project-code" class="project-code-editor" spellcheck="false" placeholder="여기에 코드를 작성하세요...">${projectCode || p.starterCode.replace(/\\n/g, '\n')}</textarea>
          <div class="code-actions">
            <button class="btn ${projectShowTrace ? 'ghost' : 'primary'}" id="run-project">
              ${projectShowTrace ? '📝 코드 수정하기' : '🔍 실행 흐름 보기'}
            </button>
            <button class="btn secondary" id="project-run-code">▶ 코드 실행</button>
            <button class="btn ghost" id="reset-code">🔄 초기화</button>
          </div>
        </div>

        <!-- 실행 결과 출력 영역 -->
        <div class="project-output-section">
          <div class="card-label">💬 실행 결과</div>
          <pre id="project-output" class="project-code-view">
여기에 실행 결과가 표시됩니다.
          </pre>
        </div>

        ${projectShowTrace ? renderProjectTraceSection() : ''}

        <!-- 규칙 설명 입력 -->
        <div class="rule-section">
          <div class="card-label">📝 내가 만든 규칙 설명</div>
          <textarea id="rule-explanation" class="rule-textarea" placeholder="내가 만든 규칙을 설명해주세요.&#10;&#10;예시:&#10;- 어떤 숫자를 출력하나요?&#10;- 왜 이 조건을 선택했나요?&#10;- 어떤 패턴이 만들어지나요?">${projectRuleExplanation}</textarea>
        </div>
        
        <!-- 학습 성찰 안내 -->
        <div class="reflection-notice">
          <div class="reflection-icon">💭</div>
          <p>이 프로젝트는 결과보다<br><strong>여러분이 만든 규칙과 설명</strong>이 더 중요합니다.</p>
        </div>

        <div class="project-submit-bar">
          <button class="btn primary" id="project-submit">
            📤 프로젝트 제출하기
          </button>
          <p class="project-submit-hint">제출하기를 누르면 다음 단계인 <strong>수업 성찰</strong>로 이동합니다.</p>
        </div>
      </div>
    </div>
  `
}

// 수업 후기 챗봇 페이지
const renderChatbotPage = () => {
  const messagesHTML = chatMessages.length > 0 
    ? chatMessages.map(msg => `
        <div class="chat-message ${msg.role}">
          <div class="message-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>
          <div class="message-content">
            <div class="message-bubble">${msg.content}</div>
          </div>
        </div>
      `).join('')
    : ''

  return `
    <div class="page-content chatbot-page">
      <div class="page-header">
        <div class="header-icon">🤖</div>
        <h1>수업 후기 챗봇</h1>
        <p class="header-desc">기말이에게 오늘 수업 후기를 들려주세요! ✨</p>
      </div>
      
      <div class="chat-and-draw-layout">
        <div class="chat-container">
          <div class="chat-messages" id="chat-messages">
            ${chatMessages.length === 0 ? `
              <div class="chat-welcome">
                <div class="welcome-avatar">🤖</div>
                <div class="welcome-text">
                  <h3>안녕! 나는 기말이야! 👋</h3>
                  <p>오늘 코딩 수업은 어땠어? 재미있었던 점이나 어려웠던 점을 편하게 이야기해줘!</p>
                </div>
              </div>
            ` : messagesHTML}
          </div>
          
          <div class="chat-input-area">
            <div class="chat-input-wrap">
              <textarea id="chat-input" placeholder="여기에 후기를 입력해주세요..." rows="2"></textarea>
              <button class="btn primary send-btn" id="send-chat">
                <span>보내기</span>
                <span>📤</span>
              </button>
            </div>
          </div>
          
          <div class="chat-quick-replies">
            <p>💬 이렇게 대답해볼 수 있어요:</p>
            <div class="quick-reply-chips">
              <button class="quick-chip" data-msg="오늘 수업 정말 재미있었어요!">😊 재미있었어요!</button>
              <button class="quick-chip" data-msg="오늘 배운 내용이 조금 어려웠어요">🤔 좀 어려웠어요</button>
              <button class="quick-chip" data-msg="다음에 게임 만들기 배우고 싶어요!">🎮 게임 만들고 싶어요</button>
              <button class="quick-chip" data-msg="선생님 설명이 이해하기 쉬웠어요">👍 설명이 좋았어요</button>
            </div>
          </div>
        </div>

        <div class="draw-container">
          <h2>🖍️ 오늘 수업을 그림으로 표현하기</h2>
          <p class="draw-desc">반복문 수업에서 떠오르는 장면이나 느낌을 자유롭게 그려보세요.</p>
          <div class="draw-toolbar">
            <label>색상
              <input type="color" id="draw-color" value="#2563eb" />
            </label>
            <label>굵기
              <input type="range" id="draw-size" min="2" max="12" value="4" />
            </label>
            <button class="btn ghost" id="draw-clear">지우기</button>
          </div>
          <div class="draw-canvas-wrap">
            <canvas id="reflection-canvas" width="400" height="260"></canvas>
          </div>
        </div>
      </div>

      <div class="chat-submit-bar">
        <button class="btn primary" id="submit-reflection">제출하기</button>
        <p class="chat-submit-hint">※ 제출하기를 누르면, 대화 내용과 그림이 나중에 Firebase로 저장될 예정입니다.</p>
      </div>
    </div>
  `
}

// ============================================
// 🐍 미니 에디터 (플로팅)
// ============================================

const renderMiniCodePreview = (code, activeLine, executedLines = []) => {
  const lines = code.split('\n')
  return lines
    .map((line, idx) => {
      const lineNumber = idx + 1
      const isActive = activeLine === lineNumber
      const isExecuted = executedLines.includes(lineNumber)
      return `<div class="mini-code-line ${isActive ? 'active' : ''} ${isExecuted && !isActive ? 'executed' : ''}">
        <span class="mini-code-lno">${lineNumber}</span>
        <span class="mini-code-text">${line || '&nbsp;'}</span>
      </div>`
    })
    .join('')
}

const getExecutedLines = (trace, currentIndex) => {
  const executed = []
  for (let i = 0; i <= currentIndex && i < trace.length; i++) {
    if (!executed.includes(trace[i].lineNum)) {
      executed.push(trace[i].lineNum)
    }
  }
  return executed
}

const renderMiniVars = (trace, currentIndex) => {
  if (currentIndex < 0 || !trace.length) {
    return '<span class="mini-vars-empty">아직 변수가 없어요</span>'
  }

  const current = trace[currentIndex]
  if (!current || !current.variables || Object.keys(current.variables).length === 0) {
    return '<span class="mini-vars-empty">아직 변수가 없어요</span>'
  }

  return Object.entries(current.variables)
    .map(([k, v]) => `<span class="mini-var-tag"><b>${k}</b> = ${v}</span>`)
    .join('')
}

// ============================================
// 🗺️ 코드 → 순서도 변환
// ============================================

const parseCodeToFlowchart = (code) => {
  const lines = code.split('\n')
  const nodes = []
  let nodeId = 0
  
  // 시작 노드
  nodes.push({ id: nodeId++, type: 'start', label: '시작', emoji: '🚀' })
  
  const indentStack = [{ indent: -1, type: 'root' }]
  
  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    
    const indent = line.length - line.trimStart().length
    const lineNum = idx + 1
    
    // 조건문/반복문 분류
    if (trimmed.startsWith('if ') || trimmed.startsWith('elif ')) {
      const condition = trimmed.replace(/^(if|elif)\s+/, '').replace(/:$/, '')
      nodes.push({
        id: nodeId++,
        type: 'condition',
        label: condition,
        emoji: '🤔',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.startsWith('else:')) {
      nodes.push({
        id: nodeId++,
        type: 'else',
        label: '그 외',
        emoji: '↪️',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.startsWith('for ')) {
      const loop = trimmed.replace(/^for\s+/, '').replace(/:$/, '')
      nodes.push({
        id: nodeId++,
        type: 'loop',
        label: loop,
        emoji: '🔄',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.startsWith('while ')) {
      const condition = trimmed.replace(/^while\s+/, '').replace(/:$/, '')
      nodes.push({
        id: nodeId++,
        type: 'loop',
        label: condition,
        emoji: '🔁',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.startsWith('def ')) {
      const funcName = trimmed.replace(/^def\s+/, '').replace(/:$/, '')
      nodes.push({
        id: nodeId++,
        type: 'function',
        label: funcName,
        emoji: '📦',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.startsWith('print(') || trimmed.includes('print(')) {
      const content = trimmed.match(/print\((.+)\)/)
      nodes.push({
        id: nodeId++,
        type: 'output',
        label: content ? content[1].substring(0, 20) + (content[1].length > 20 ? '...' : '') : 'print',
        emoji: '💬',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.includes('input(')) {
      nodes.push({
        id: nodeId++,
        type: 'input',
        label: '입력 받기',
        emoji: '⌨️',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.includes('=') && !trimmed.includes('==')) {
      const varName = trimmed.split('=')[0].trim()
      nodes.push({
        id: nodeId++,
        type: 'process',
        label: trimmed.length > 25 ? varName + ' = ...' : trimmed,
        emoji: '📝',
        lineNum,
        fullLine: trimmed
      })
    } else if (trimmed.startsWith('return')) {
      nodes.push({
        id: nodeId++,
        type: 'return',
        label: trimmed,
        emoji: '↩️',
        lineNum,
        fullLine: trimmed
      })
    } else {
      nodes.push({
        id: nodeId++,
        type: 'process',
        label: trimmed.substring(0, 25) + (trimmed.length > 25 ? '...' : ''),
        emoji: '⚙️',
        lineNum,
        fullLine: trimmed
      })
    }
  })
  
  // 끝 노드
  nodes.push({ id: nodeId++, type: 'end', label: '끝', emoji: '🏁' })
  
  return nodes
}

const renderMiniFlowchart = (code, currentLine = -1) => {
  const nodes = parseCodeToFlowchart(code)
  
  if (nodes.length <= 2) {
    return '<p class="muted">📊 코드를 입력하면 순서도가 생성돼요!</p>'
  }
  
  const parts = []
  
  nodes.forEach((node, idx) => {
    const isActive = node.lineNum === currentLine
    const activeClass = isActive ? 'active' : ''
    
    switch (node.type) {
      case 'start':
        parts.push(`
          <div class="flow-mini-node start ${activeClass}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span>${node.label}</span>
          </div>
        `)
        break
      case 'end':
        parts.push(`
          <div class="flow-mini-node end ${activeClass}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span>${node.label}</span>
          </div>
        `)
        break
      case 'condition':
        parts.push(`
          <div class="flow-mini-node condition ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
            <div class="flow-mini-branches">
              <span class="branch-yes">✅ 예</span>
              <span class="branch-no">❌ 아니오</span>
            </div>
          </div>
        `)
        break
      case 'else':
        parts.push(`
          <div class="flow-mini-node else-node ${activeClass}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span>${node.label}</span>
          </div>
        `)
        break
      case 'loop':
        parts.push(`
          <div class="flow-mini-node loop ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
            <div class="flow-mini-loop-arrow">↺ 반복</div>
          </div>
        `)
        break
      case 'function':
        parts.push(`
          <div class="flow-mini-node function ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
          </div>
        `)
        break
      case 'output':
        parts.push(`
          <div class="flow-mini-node output ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
          </div>
        `)
        break
      case 'input':
        parts.push(`
          <div class="flow-mini-node input ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
          </div>
        `)
        break
      case 'return':
        parts.push(`
          <div class="flow-mini-node return ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
          </div>
        `)
        break
      default:
        parts.push(`
          <div class="flow-mini-node process ${activeClass}" title="${node.fullLine || ''}">
            <span class="flow-mini-emoji">${node.emoji}</span>
            <span class="flow-mini-label">${node.label}</span>
          </div>
        `)
    }
    
    // 화살표 (마지막 노드 제외)
    if (idx < nodes.length - 1) {
      parts.push('<div class="flow-mini-arrow">↓</div>')
    }
  })
  
  return parts.join('')
}

const renderMiniEditor = () => {
  if (currentPage === 'trace' || currentPage === 'intro') return ''
  
  if (!miniEditorOpen) {
    return `
      <button class="mini-editor-fab" id="open-mini-editor">
        <span>🔍</span>
        <span class="fab-text">코드 도우미</span>
      </button>
    `
  }

  // 현재 trace 정보 (miniStepTrace 사용)
  const currentTrace = miniStepTrace
  const currentStep = currentTrace[miniStepIndex] || null
  const isFinished = miniStepIndex >= currentTrace.length - 1
  
  // 현재까지의 출력 (end 파라미터 고려)
  const outputLines = []
  let currentLine = ''
  for (let i = 0; i <= miniStepIndex && i < currentTrace.length; i++) {
    const t = currentTrace[i]
    if (t.output !== null) {
      currentLine += t.output
      if (t.endChar === '\n' || t.endChar === undefined) {
        outputLines.push(currentLine)
        currentLine = ''
      } else {
        currentLine += t.endChar
      }
    }
  }
  if (currentLine) outputLines.push(currentLine)

  // 코드 라인 렌더링 함수
  const renderHelperCodeLines = () => {
    return miniEditorCode.split('\n').map((line, idx) => {
      const lineNum = idx + 1
      const isActive = currentStep?.lineNum === lineNum
      const isExecuted = currentTrace.slice(0, miniStepIndex + 1).some(t => t.lineNum === lineNum)
      const classes = ['helper-code-row']
      if (isActive) classes.push('active')
      if (isExecuted && !isActive) classes.push('executed')
      return '<div class="' + classes.join(' ') + '">' +
        '<span class="helper-line-num">' + lineNum + '</span>' +
        '<span class="helper-line-code">' + (highlightPython(line) || ' ') + '</span>' +
        '</div>'
    }).join('')
  }
  
  // 트레이스 테이블 렌더링 함수
  const renderHelperTraceRows = () => {
    return currentTrace.slice(0, miniStepIndex + 1).map((t, i) => {
      const rowClass = (i === miniStepIndex ? 'current' : 'executed') + ' ' + t.type
      const vars = Object.entries(t.variables).map(([k,v]) => '<span class="var-chip">' + k + '=' + v + '</span>').join(' ') || '-'
      const output = t.output !== null ? '"' + t.output + '"' : '-'
      return '<tr class="' + rowClass + '">' +
        '<td class="step-num">' + t.step + '</td>' +
        '<td class="line-num">' + t.lineNum + '</td>' +
        '<td class="vars-cell">' + vars + '</td>' +
        '<td class="output-cell">' + output + '</td>' +
        '</tr>'
    }).join('')
  }

  // 스텝 모드 UI (실행 흐름 표시)
  const stepModeUI = miniStepMode ? `
    <div class="helper-trace-container">
      <div class="helper-main-area">
        <div class="helper-code-section">
          <div class="helper-section-title">💻 코드</div>
          <div class="helper-code-lines">
            ${renderHelperCodeLines()}
          </div>
        </div>
        
        <div class="helper-trace-section">
          <div class="helper-section-title">📊 실행 단계</div>
          <div class="helper-trace-table-wrap">
            <table class="helper-trace-table">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>줄</th>
                  <th>변수</th>
                  <th>출력</th>
                </tr>
              </thead>
              <tbody>
                ${renderHelperTraceRows()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <!-- 출력 결과 영역 (항상 표시) -->
      <div class="helper-output-section">
        <div class="helper-section-title">💬 출력 결과</div>
        <pre class="helper-output-text">${outputLines.length > 0 ? outputLines.join('\n') : '(아직 출력 없음)'}</pre>
      </div>
      
      <div class="helper-status">
        <div class="helper-step-info">
          <span class="helper-step-badge">${miniStepIndex + 1} / ${currentTrace.length}</span>
          <span class="helper-step-desc">${currentStep?.description || '준비 완료'}</span>
        </div>
        ${currentStep?.iteration ? '<span class="helper-iter-badge">🔄 ' + currentStep.iteration + '번째 반복</span>' : ''}
      </div>
      
      <div class="helper-controls">
        <button class="btn mini ghost" id="mini-step-reset" ${miniStepIndex <= 0 ? 'disabled' : ''}>⏮️ 처음</button>
        <button class="btn mini ghost" id="mini-step-prev" ${miniStepIndex <= 0 ? 'disabled' : ''}>◀️</button>
        <button class="btn mini primary" id="mini-step-next" ${isFinished ? 'disabled' : ''}>
          ${isFinished ? '✅ 완료!' : '▶️ 다음'}
        </button>
        <button class="btn mini ghost" id="mini-step-exit">✕ 종료</button>
      </div>
    </div>
  ` : ''

  // 일반 모드 UI (코드 입력)
  const normalModeUI = !miniStepMode ? `
    <div class="mini-editor-body">
      <textarea id="mini-code-input" spellcheck="false" placeholder="반복문 코드를 입력하세요...">${miniEditorCode}</textarea>
      <div class="mini-editor-actions">
        <button class="btn mini primary" id="mini-step-start">🔍 실행 흐름 보기</button>
        <button class="btn mini ghost" id="mini-clear">🗑️</button>
      </div>
      <div class="helper-hint">
        <p>💡 <strong>지원 문법:</strong> for문, print(), 변수 할당</p>
      </div>
    </div>
  ` : ''

  return `
    <div class="mini-editor ${miniEditorMinimized ? 'minimized' : ''} ${miniStepMode ? 'step-mode' : ''}" id="mini-editor">
      <div class="mini-editor-header" id="mini-editor-header">
        <div class="mini-editor-title">
          <span>🔍</span>
          <span>${miniStepMode ? '실행 흐름 보기' : '코드 도우미'}</span>
        </div>
        <div class="mini-editor-controls">
          <button class="mini-ctrl-btn" id="mini-minimize" title="${miniEditorMinimized ? '최대화' : '최소화'}">
            ${miniEditorMinimized ? '🔼' : '🔽'}
          </button>
          <button class="mini-ctrl-btn" id="mini-close" title="닫기">✕</button>
        </div>
      </div>
      ${!miniEditorMinimized ? (miniStepMode ? stepModeUI : normalModeUI) : ''}
      <!-- 크기 조절 핸들 (모든 모서리/변) -->
      <div class="resize-handle resize-n" data-dir="n"></div>
      <div class="resize-handle resize-ne" data-dir="ne"></div>
      <div class="resize-handle resize-e" data-dir="e"></div>
      <div class="resize-handle resize-se" data-dir="se"></div>
      <div class="resize-handle resize-s" data-dir="s"></div>
      <div class="resize-handle resize-sw" data-dir="sw"></div>
      <div class="resize-handle resize-w" data-dir="w"></div>
      <div class="resize-handle resize-nw" data-dir="nw"></div>
    </div>
  `
}

// ============================================
// 🎮 메인 렌더링 및 이벤트 핸들러
// ============================================

const renderApp = () => {
  const app = document.querySelector('#app')
  
  if (currentPage === 'intro') {
    app.innerHTML = renderIntroPage()
    attachIntroEvents()
    return
  }
  
  let pageContent = ''
  switch (currentPage) {
    case 'concept':
      pageContent = renderConceptPage()
      break
    case 'trace':
      pageContent = renderPythonPage()
      break
    case 'practice':
      pageContent = renderPracticePage()
      break
    case 'project':
      pageContent = renderProjectPage()
      break
    case 'reflection':
      pageContent = renderChatbotPage()
      break
    default:
      pageContent = renderConceptPage()
  }

  app.innerHTML = `
    <div class="app-container ${layoutMode === 'desktop' ? 'desktop-layout' : 'mobile-layout'}">
      <div class="background-decorations">
        <div class="floating-shape shape-1">🌟</div>
        <div class="floating-shape shape-2">💫</div>
        <div class="floating-shape shape-3">✨</div>
        <div class="floating-shape shape-4">🎈</div>
        <div class="floating-shape shape-5">🌈</div>
      </div>
      ${renderNavigation()}
      <main class="main-content">
        ${pageContent}
    </main>
      ${renderMiniEditor()}
      ${renderLayoutSelector()}
    </div>
  `

  attachEvents()
  updateApiKeyStatusUI()
}

// Firebase 인증 상태 감시 (student.html에서만 의미 있음)
// Netlify 환경에서 안정적인 인증 체크를 위한 로직
let authCheckTimeout = null
let hasCheckedAuth = false
let authCheckAttempts = 0
const MAX_AUTH_CHECK_ATTEMPTS = 5

// 페이지 로드 시 이전 세션 스토리지 정리 (필요시)
if (typeof window !== 'undefined' && window.location.pathname.includes('student')) {
  // 페이지가 정상적으로 로드되면 플래그는 유지, 그렇지 않으면 정리
  const authVerified = sessionStorage.getItem('auth_verified')
  if (authVerified && !auth.currentUser) {
    // 5초 후에도 인증 상태가 없으면 플래그 제거 (비정상 종료 대응)
    setTimeout(() => {
      if (!auth.currentUser) {
        sessionStorage.removeItem('auth_verified')
        sessionStorage.removeItem('auth_uid')
      }
    }, 5000)
  }
}

onAuthStateChanged(auth, (user) => {
  firebaseUser = user
  
  // student.html 페이지에서만 인증 체크 수행
  if (window.location.pathname.includes('student')) {
    // 세션 스토리지에서 인증 확인 플래그 확인 (리다이렉트 루프 방지)
    const authVerified = sessionStorage.getItem('auth_verified')
    const authUid = sessionStorage.getItem('auth_uid')
    
    // 첫 번째 인증 상태 확인 시
    if (!hasCheckedAuth) {
      hasCheckedAuth = true
      authCheckAttempts = 0
      
      // 세션 스토리지에 플래그가 있으면 인증된 것으로 간주
      if (authVerified === 'true' && (user || authUid)) {
        console.log('세션 스토리지에서 인증 확인됨, 앱 렌더링')
        renderApp()
        return
      }
      
      // 인증 상태 재확인 (Netlify 환경 대응: 더 긴 지연)
      if (authCheckTimeout) clearTimeout(authCheckTimeout)
      authCheckTimeout = setTimeout(() => {
        authCheckAttempts++
        const currentUser = auth.currentUser
        
        // 세션 스토리지 플래그 재확인
        const retryAuthVerified = sessionStorage.getItem('auth_verified')
        
        if (currentUser || retryAuthVerified === 'true') {
          console.log('인증된 사용자 확인:', currentUser?.email || '세션 확인')
          renderApp()
        } else if (authCheckAttempts < MAX_AUTH_CHECK_ATTEMPTS) {
          // 재시도 (Netlify에서 인증 상태 동기화가 느릴 수 있음)
          console.log(`인증 상태 확인 재시도 ${authCheckAttempts}/${MAX_AUTH_CHECK_ATTEMPTS}`)
          authCheckTimeout = setTimeout(() => {
            const retryUser = auth.currentUser
            if (retryUser) {
              console.log('재시도 후 인증 확인됨:', retryUser.email)
              renderApp()
            } else {
              console.log('인증되지 않은 사용자, 메인 페이지로 리다이렉트')
              sessionStorage.removeItem('auth_verified')
              sessionStorage.removeItem('auth_uid')
              window.location.href = '/'
            }
          }, 300)
        } else {
          // 최대 재시도 횟수 초과
          console.log('인증 확인 실패, 메인 페이지로 리다이렉트')
          sessionStorage.removeItem('auth_verified')
          sessionStorage.removeItem('auth_uid')
          window.location.href = '/'
        }
      }, 300) // Netlify 환경을 고려하여 300ms로 증가
    } else {
      // 이후 인증 상태 변화는 즉시 처리
      if (!user) {
        // 세션 스토리지 플래그도 확인
        if (authVerified !== 'true') {
          console.log('로그아웃 감지, 메인 페이지로 리다이렉트')
          sessionStorage.removeItem('auth_verified')
          sessionStorage.removeItem('auth_uid')
          window.location.href = '/'
        } else {
          // 세션 플래그가 있으면 유지 (일시적인 인증 상태 불일치 가능성)
          console.log('인증 상태 불일치 가능성, 세션 플래그 유지')
          renderApp()
        }
      } else {
        renderApp()
      }
    }
  } else {
    // student.html이 아닌 페이지에서는 renderApp만 호출
    renderApp()
  }
})

const attachIntroEvents = () => {
  // 기존 시작 버튼은 사용하지 않음 (학생 정보 입력 카드에서 바로 시작)
  const studentStartBtn = document.querySelector('#student-start-btn')
  if (studentStartBtn) {
    studentStartBtn.addEventListener('click', () => {
      const classInput = document.querySelector('#student-class')
      const numberInput = document.querySelector('#student-number')
      const nameInput = document.querySelector('#student-name')

      const klass = classInput?.value.trim() || ''
      const number = numberInput?.value.trim() || ''
      const name = nameInput?.value.trim() || ''

      if (!klass || !number || !name) {
        alert('반, 번호, 이름을 모두 입력해 주세요!')
        return
      }

      studentInfo = { klass, number, name }
      currentPage = 'concept'
      renderApp()
      // 상단 메뉴까지 함께 보이도록 화면을 맨 위로 스크롤
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
}

// 미니 에디터 UI만 업데이트
const updateMiniEditorUI = () => {
  const editor = document.querySelector('#mini-editor')
  if (!editor) return

  if (miniStepMode && miniStepTrace.length > 0) {
    const currentStep = miniStepTrace[miniStepIndex]
    const isFinished = miniStepIndex >= miniStepTrace.length - 1
    const isFirst = miniStepIndex === 0
    
    // 코드 라인 업데이트
    const codeLines = editor.querySelector('.helper-code-lines')
    if (codeLines) {
      codeLines.innerHTML = miniEditorCode.split('\n').map((line, idx) => {
        const lineNum = idx + 1
        const isActive = currentStep?.lineNum === lineNum
        const isExecuted = miniStepTrace.slice(0, miniStepIndex + 1).some(t => t.lineNum === lineNum)
        const classes = ['helper-code-row']
        if (isActive) classes.push('active')
        if (isExecuted && !isActive) classes.push('executed')
        return '<div class="' + classes.join(' ') + '">' +
          '<span class="helper-line-num">' + lineNum + '</span>' +
          '<span class="helper-line-code">' + (highlightPython(line) || ' ') + '</span>' +
          '</div>'
      }).join('')
    }
    
    // 트레이스 테이블 업데이트
    const traceBody = editor.querySelector('.helper-trace-table tbody')
    if (traceBody) {
      traceBody.innerHTML = miniStepTrace.slice(0, miniStepIndex + 1).map((t, i) => {
        const rowClass = (i === miniStepIndex ? 'current' : 'executed') + ' ' + t.type
        const vars = Object.entries(t.variables).map(([k,v]) => '<span class="var-chip">' + k + '=' + v + '</span>').join(' ') || '-'
        const output = t.output !== null ? '"' + t.output + '"' : '-'
        return '<tr class="' + rowClass + '">' +
          '<td class="step-num">' + t.step + '</td>' +
          '<td class="line-num">' + t.lineNum + '</td>' +
          '<td class="vars-cell">' + vars + '</td>' +
          '<td class="output-cell">' + output + '</td>' +
          '</tr>'
      }).join('')
      
      // 테이블 스크롤
      const tableWrap = editor.querySelector('.helper-trace-table-wrap')
      if (tableWrap) {
        tableWrap.scrollTop = tableWrap.scrollHeight
      }
    }
    
    // 상태 정보 업데이트
    const stepBadge = editor.querySelector('.helper-step-badge')
    if (stepBadge) {
      stepBadge.textContent = `${miniStepIndex + 1} / ${miniStepTrace.length}`
    }
    
    const stepDesc = editor.querySelector('.helper-step-desc')
    if (stepDesc) {
      stepDesc.textContent = currentStep?.description || '준비 완료'
    }
    
    const iterBadge = editor.querySelector('.helper-iter-badge')
    if (iterBadge) {
      if (currentStep?.iteration) {
        iterBadge.textContent = `🔄 ${currentStep.iteration}번째 반복`
        iterBadge.style.display = ''
      } else {
        iterBadge.style.display = 'none'
      }
    }
    
    // 버튼 상태 업데이트
    const nextBtn = editor.querySelector('#mini-step-next')
    const prevBtn = editor.querySelector('#mini-step-prev')
    const resetBtn = editor.querySelector('#mini-step-reset')
    
    if (nextBtn) {
      nextBtn.disabled = isFinished
      nextBtn.innerHTML = isFinished ? '✅ 완료!' : '▶️ 다음'
    }
    if (prevBtn) prevBtn.disabled = isFirst
    if (resetBtn) resetBtn.disabled = isFirst
    
    // 출력 업데이트
    const outputText = editor.querySelector('.helper-output-text')
    const outputSection = editor.querySelector('.helper-output-section')
    if (outputText) {
      const outputLines = []
      let currentLine = ''
      for (let i = 0; i <= miniStepIndex; i++) {
        const step = miniStepTrace[i]
        if (step.output !== null) {
          currentLine += step.output
          const endChar = step.endChar !== undefined ? step.endChar : '\n'
          if (endChar === '\n') {
            outputLines.push(currentLine)
            currentLine = ''
          } else {
            currentLine += endChar
          }
        }
      }
      if (currentLine) outputLines.push(currentLine)
      
      const hasOutput = outputLines.length > 0
      outputText.textContent = hasOutput ? outputLines.join('\n') : '(아직 출력 없음)'
      
      // 출력이 있으면 하이라이트
      if (outputSection) {
        if (hasOutput) {
          outputSection.classList.add('has-output')
        } else {
          outputSection.classList.remove('has-output')
        }
      }
    }
  }
}

// 미니 에디터 드래그 기능
let isDragging = false
let dragOffset = { x: 0, y: 0 }

const initMiniEditorDrag = () => {
  const header = document.querySelector('#mini-editor-header')
  const editor = document.querySelector('#mini-editor')
  
  if (!header || !editor) return

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mini-ctrl-btn')) return
    isDragging = true
    const rect = editor.getBoundingClientRect()
    dragOffset.x = e.clientX - rect.left
    dragOffset.y = e.clientY - rect.top
    editor.style.cursor = 'grabbing'
  })

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    const x = e.clientX - dragOffset.x
    const y = e.clientY - dragOffset.y
    editor.style.left = `${Math.max(0, Math.min(x, window.innerWidth - 100))}px`
    editor.style.top = `${Math.max(0, Math.min(y, window.innerHeight - 100))}px`
    editor.style.right = 'auto'
    editor.style.bottom = 'auto'
  })

  document.addEventListener('mouseup', () => {
    isDragging = false
    if (editor) editor.style.cursor = ''
  })
}

// 미니 에디터 리사이즈 기능 (모든 모서리/변)
let isResizing = false
let resizeDir = ''
let resizeStart = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 }
let resizeListenersAttached = false

const initMiniEditorResize = () => {
  const editor = document.querySelector('#mini-editor')
  if (!editor) return

  const handles = editor.querySelectorAll('.resize-handle')
  if (!handles.length) return

  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()

      const rect = editor.getBoundingClientRect()
      // 시작 상태 저장
      resizeDir = handle.dataset.dir || ''
      resizeStart = {
        x: e.clientX,
        y: e.clientY,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top
      }

      // 절대 위치 기준으로 전환
      editor.style.left = rect.left + 'px'
      editor.style.top = rect.top + 'px'
      editor.style.right = 'auto'
      editor.style.bottom = 'auto'

      isResizing = true
    })
  })

  if (!resizeListenersAttached) {
    const onMouseMove = (e) => {
      if (!isResizing) return
      const editorEl = document.querySelector('#mini-editor')
      if (!editorEl) return

      const dx = e.clientX - resizeStart.x
      const dy = e.clientY - resizeStart.y

      const minWidth = 320
      const minHeight = 260

      let newWidth = resizeStart.width
      let newHeight = resizeStart.height
      let newLeft = resizeStart.left
      let newTop = resizeStart.top

      if (resizeDir.includes('e')) {
        newWidth = resizeStart.width + dx
      }
      if (resizeDir.includes('s')) {
        newHeight = resizeStart.height + dy
      }
      if (resizeDir.includes('w')) {
        newWidth = resizeStart.width - dx
        newLeft = resizeStart.left + dx
      }
      if (resizeDir.includes('n')) {
        newHeight = resizeStart.height - dy
        newTop = resizeStart.top + dy
      }

      // 최소/최대 크기 제한
      newWidth = Math.max(minWidth, Math.min(newWidth, window.innerWidth - 40))
      newHeight = Math.max(minHeight, Math.min(newHeight, window.innerHeight - 40))

      editorEl.style.width = newWidth + 'px'
      editorEl.style.height = newHeight + 'px'
      editorEl.style.left = Math.max(0, newLeft) + 'px'
      editorEl.style.top = Math.max(0, newTop) + 'px'
      editorEl.style.right = 'auto'
      editorEl.style.bottom = 'auto'
    }

    const onMouseUp = () => {
      isResizing = false
      resizeDir = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    resizeListenersAttached = true
  }
}

const attachEvents = () => {
  // 홈 로고 클릭
  const goHome = document.querySelector('#go-home')
  if (goHome) {
    goHome.addEventListener('click', () => {
      currentPage = 'intro'
      renderApp()
    })
  }

  // 네비게이션 탭
  const navTabs = document.querySelectorAll('.nav-tab')
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page
      if (page !== currentPage) {
        currentPage = page
        renderApp()
      }
    })
  })

  // 상단 학생 로그아웃 버튼 (student.html용)
  const studentLogoutBtn = document.querySelector('#student-logout-btn')
  if (studentLogoutBtn) {
    studentLogoutBtn.addEventListener('click', async () => {
      try {
        await signOut(auth)
      } finally {
        window.location.href = '/student.html'
      }
    })
  }

  // 레이아웃 모드 선택기 (왼쪽 아래)
  const layoutModeSelect = document.querySelector('#layout-mode-select')
  if (layoutModeSelect) {
    layoutModeSelect.addEventListener('change', (e) => {
      layoutMode = e.target.value
      localStorage.setItem('layoutMode', layoutMode)
      renderApp()
    })
  }
  
  // 성찰 페이지 이벤트
  if (currentPage === 'reflection') {
    const sendChatBtn = document.querySelector('#send-chat')
    const chatInput = document.querySelector('#chat-input')
    
    const sendMessage = async () => {
      const message = chatInput.value.trim()
      if (!message) return
      
      chatMessages.push({ role: 'user', content: message })
      chatInput.value = ''
      renderApp()
      
      const messagesDiv = document.querySelector('#chat-messages')
      if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight
      
      // 로딩 표시
      const loadingMsg = document.createElement('div')
      loadingMsg.className = 'chat-message assistant loading'
      loadingMsg.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-bubble">생각 중... 💭</div>
        </div>
      `
      messagesDiv?.appendChild(loadingMsg)
      
      const response = await sendToChatGPT(message)
      chatMessages.push({ role: 'assistant', content: response })
      renderApp()
      
      const newMessagesDiv = document.querySelector('#chat-messages')
      if (newMessagesDiv) newMessagesDiv.scrollTop = newMessagesDiv.scrollHeight
    }
    
    if (sendChatBtn) {
      sendChatBtn.addEventListener('click', sendMessage)
    }
    
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          sendMessage()
        }
      })
    }
    
    // 빠른 답변 칩
    const quickChips = document.querySelectorAll('.quick-chip')
    quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.dataset.msg
        if (chatInput) {
          chatInput.value = msg
          chatInput.focus()
        }
      })
    })
  }

  // 미니 에디터 열기
  const openMiniBtn = document.querySelector('#open-mini-editor')
  if (openMiniBtn) {
    openMiniBtn.addEventListener('click', () => {
      miniEditorOpen = true
      miniEditorMinimized = false
      miniStepMode = false
      renderApp()
    })
  }

  // 미니 에디터 컨트롤
  const miniClose = document.querySelector('#mini-close')
  const miniMinimize = document.querySelector('#mini-minimize')
  
  if (miniClose) {
    miniClose.addEventListener('click', () => {
      miniEditorOpen = false
      miniStepMode = false
      showFlowchart = false
      renderApp()
    })
  }

  if (miniMinimize) {
    miniMinimize.addEventListener('click', () => {
      miniEditorMinimized = !miniEditorMinimized
      renderApp()
    })
  }

  // 미니 에디터 코드 저장
  const miniInput = document.querySelector('#mini-code-input')
  if (miniInput) {
    miniInput.addEventListener('input', () => {
      miniEditorCode = miniInput.value
    })
  }

  // 미니 에디터 실행
  const miniRun = document.querySelector('#mini-run')
  if (miniRun) {
    miniRun.addEventListener('click', async () => {
      const output = document.querySelector('#mini-output')
      const code = document.querySelector('#mini-code-input').value
      miniEditorCode = code
      
      output.innerHTML = '<p class="loading">⏳ 실행 중...</p>'
      
      try {
        const result = await runPython(code)
        if (result.status === 'ok') {
          const outputText = result.output?.length 
            ? result.output.join('\n') 
            : '(출력 없음)'
          output.innerHTML = `
            <div class="output-success">
              <p class="output-header">✅ 실행 성공!</p>
              <pre class="output-text">${outputText}</pre>
            </div>
          `
        } else {
          output.innerHTML = `
            <div class="output-error">
              <p class="output-header">❌ 오류 발생</p>
              <p class="error-friendly">${friendlyExplain(result.error)}</p>
              <pre class="error-detail">${result.error}</pre>
            </div>
          `
        }
      } catch (err) {
        output.innerHTML = `
          <div class="output-error">
            <p class="output-header">😓 실행 실패</p>
            <p>네트워크나 Pyodide 로드 상태를 확인해 주세요.</p>
          </div>
        `
      }
    })
  }

  // 미니 에디터 (코드 도우미) 스텝 모드 - fakeInterpreter 사용
  const miniStepStart = document.querySelector('#mini-step-start')
  if (miniStepStart) {
    miniStepStart.addEventListener('click', () => {
      const code = document.querySelector('#mini-code-input').value
      miniEditorCode = code
      
      // fakeInterpreter로 trace 생성
      const result = fakeInterpreter(code)
      
      if (result.trace?.length > 0) {
        miniStepTrace = result.trace
        miniStepOutput = result.outputs || []
        miniStepIndex = 0
        miniStepMode = true
        renderApp()
      } else {
        alert('⚠️ 실행할 for 반복문이 없어요!\n\nfor i in range(5):\n    print(i)\n\n형태로 입력해주세요.')
      }
    })
  }

// 스텝 모드 컨트롤 - 다음
  const miniStepNext = document.querySelector('#mini-step-next')
  if (miniStepNext) {
    miniStepNext.addEventListener('click', (e) => {
      e.preventDefault()
      if (miniStepIndex < miniStepTrace.length - 1) {
        miniStepIndex++
        updateMiniEditorUI()
      }
    })
  }

  // 스텝 모드 컨트롤 - 이전
  const miniStepPrev = document.querySelector('#mini-step-prev')
  if (miniStepPrev) {
    miniStepPrev.addEventListener('click', (e) => {
      e.preventDefault()
      if (miniStepIndex > 0) {
        miniStepIndex--
        updateMiniEditorUI()
      }
    })
  }

  // 스텝 모드 컨트롤 - 처음으로
  const miniStepReset = document.querySelector('#mini-step-reset')
  if (miniStepReset) {
    miniStepReset.addEventListener('click', (e) => {
      e.preventDefault()
      miniStepIndex = 0
      updateMiniEditorUI()
    })
  }

  const miniStepExit = document.querySelector('#mini-step-exit')
  if (miniStepExit) {
    miniStepExit.addEventListener('click', () => {
      miniStepMode = false
      miniStepIndex = 0
      renderApp()
    })
  }

  // 미니 에디터 지우기
  const miniClear = document.querySelector('#mini-clear')
  if (miniClear) {
    miniClear.addEventListener('click', () => {
      const input = document.querySelector('#mini-code-input')
      if (input) {
        input.value = ''
        miniEditorCode = ''
      }
      renderApp()
    })
  }

  // 순서도 토글 (일반 모드)
  const flowchartToggle = document.querySelector('#mini-flowchart-toggle')
  if (flowchartToggle) {
    flowchartToggle.addEventListener('click', () => {
      const input = document.querySelector('#mini-code-input')
      if (input) miniEditorCode = input.value
      showFlowchart = !showFlowchart
      renderApp()
    })
  }

  // 스텝 모드 뷰 토글
  const viewCodeBtn = document.querySelector('#view-code')
  const viewFlowchartBtn = document.querySelector('#view-flowchart')
  
  if (viewCodeBtn) {
    viewCodeBtn.addEventListener('click', () => {
      if (showFlowchart) {
        showFlowchart = false
        renderApp()
      }
    })
  }
  
  if (viewFlowchartBtn) {
    viewFlowchartBtn.addEventListener('click', () => {
      if (!showFlowchart) {
        showFlowchart = true
        renderApp()
      }
    })
  }

  // 미니 에디터 드래그/리사이즈 초기화
  initMiniEditorDrag()
  initMiniEditorResize()

  // 개념 페이지 이벤트
  if (currentPage === 'concept') {
    // 진행 바 클릭
    const progressSteps = document.querySelectorAll('.progress-step')
    progressSteps.forEach(step => {
      step.addEventListener('click', () => {
        conceptStep = parseInt(step.dataset.step)
        renderApp()
      })
    })
    
    // 이전 버튼
    const prevBtn = document.querySelector('#concept-prev')
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (conceptStep > 0) {
          conceptStep--
          renderApp()
        }
      })
    }
    
    // 다음 버튼
    const nextBtn = document.querySelector('#concept-next')
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (conceptStep >= conceptSteps.length - 1) {
          // 마지막 단계면 실행 흐름 페이지로 이동
          currentPage = 'trace'
          conceptStep = 0
          renderApp()
        } else {
          conceptStep++
          renderApp()
        }
      })
    }
    
    // 실행 흐름 보기 버튼 - 코드 도우미 열기
    const tryCodeBtns = document.querySelectorAll('.try-code-btn')
    tryCodeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.example-card')
        const code = card?.dataset?.code
        if (code) {
          miniEditorCode = code.replace(/\\n/g, '\n')
          
          // fakeInterpreter로 trace 생성
          const result = fakeInterpreter(miniEditorCode)
          if (result.trace?.length > 0) {
            miniStepTrace = result.trace
            miniStepIndex = 0
            miniStepMode = true
            miniEditorOpen = true
            miniEditorMinimized = false
            renderApp()
          }
        }
      })
    })
    
    // for문 놀이터 이벤트
    const rangeSlider = document.querySelector('#range-slider')
    const runForDemo = document.querySelector('#run-for-demo')
    const funCards = document.querySelectorAll('.fun-card')
    
    if (rangeSlider) {
      rangeSlider.addEventListener('input', () => {
        forRangeValue = parseInt(rangeSlider.value)
        forOutput = []
        forCurrentI = -1
        
        // 슬라이더 값 표시 업데이트
        const display = document.querySelector('#slider-display')
        if (display) display.textContent = forRangeValue
        
        // range 숫자 업데이트
        const rangeNum = document.querySelector('.range-num')
        if (rangeNum) rangeNum.textContent = forRangeValue
        
        // 숫자 공 업데이트
        const ballsContainer = document.querySelector('#number-balls')
        if (ballsContainer) {
          let balls = ''
          for (let i = 0; i < forRangeValue; i++) {
            balls += `<div class="number-ball">${i}</div>`
          }
          ballsContainer.innerHTML = balls
        }
        
        // 출력 초기화
        const outputDisplay = document.querySelector('#for-output-display')
        if (outputDisplay) {
          outputDisplay.innerHTML = '<span class="waiting">실행 버튼을 눌러보세요!</span>'
        }
      })
    }
    
    if (runForDemo) {
      runForDemo.addEventListener('click', async () => {
        forRunning = true
        forOutput = []
        forCurrentI = -1
        runForDemo.disabled = true
        runForDemo.textContent = '⏳ 실행 중...'
        
        const outputDisplay = document.querySelector('#for-output-display')
        if (outputDisplay) outputDisplay.innerHTML = ''
        
        for (let i = 0; i < forRangeValue; i++) {
          forCurrentI = i
          
          // 숫자 공 하이라이트
          const balls = document.querySelectorAll('.number-ball')
          balls.forEach((ball, idx) => {
            ball.classList.remove('active')
            if (idx === i) ball.classList.add('active')
            if (forOutput.includes(idx)) ball.classList.add('done')
          })
          
          await sleep(300)
          
          // 출력 추가
          forOutput.push(i)
          if (outputDisplay) {
            outputDisplay.innerHTML += `<span class="out-num pop">${i}</span>`
          }
          
          await sleep(200)
        }
        
        // 완료
        forRunning = false
        forCurrentI = -1
        runForDemo.disabled = false
        runForDemo.textContent = '▶ 다시 실행'
        
        // 모든 공 done 상태로
        document.querySelectorAll('.number-ball').forEach(ball => {
          ball.classList.remove('active')
          ball.classList.add('done')
        })
      })
    }
    
    // 재미있는 예시 카드
    funCards.forEach(card => {
      card.addEventListener('click', async () => {
        const example = card.dataset.example
        const demoArea = document.querySelector('#fun-demo-area')
        if (!demoArea) return
        
        const examples = {
          stars: {
            code: 'for i in range(5):\n    print("⭐", end="")',
            output: '⭐⭐⭐⭐⭐'
          },
          countdown: {
            code: 'for i in range(5, 0, -1):\n    print(i)\nprint("🚀 발사!")',
            output: '5\n4\n3\n2\n1\n🚀 발사!'
          },
          gugudan: {
            code: 'for i in range(1, 10):\n    print(f"3 x {i} = {3*i}")',
            output: '3 x 1 = 3\n3 x 2 = 6\n3 x 3 = 9\n...'
          },
          emoji: {
            code: 'for i in range(5):\n    print("😀" * (i+1))',
            output: '😀\n😀😀\n😀😀😀\n😀😀😀😀\n😀😀😀😀😀'
          }
        }
        
        const ex = examples[example]
        demoArea.innerHTML = `
          <div class="fun-demo-content">
            <div class="demo-code">
              <div class="demo-label">📝 코드</div>
              <pre>${ex.code}</pre>
            </div>
            <div class="demo-output">
              <div class="demo-label">💬 출력</div>
              <pre>${ex.output}</pre>
            </div>
          </div>
        `
        demoArea.classList.add('show')
      })
    })

    // while문 놀이터 이벤트
    const countdownSlider = document.querySelector('#countdown-slider')
    const runCountdownDemo = document.querySelector('#run-countdown-demo')
    const whileExCards = document.querySelectorAll('.while-ex-card')

    if (countdownSlider) {
      countdownSlider.addEventListener('input', () => {
        countdownStart = parseInt(countdownSlider.value)
        countdownOutput = []
        countdownCurrent = -1

        // 슬라이더 값 표시 업데이트
        const display = document.querySelector('#countdown-display')
        if (display) display.textContent = countdownStart

        // 코드에서 숫자 업데이트
        const countdownNum = document.querySelector('.countdown-num')
        if (countdownNum) countdownNum.textContent = countdownStart

        // 숫자 공 업데이트
        const ballsContainer = document.querySelector('#countdown-balls')
        if (ballsContainer) {
          let balls = ''
          for (let i = countdownStart; i >= 1; i--) {
            balls += `<div class="countdown-ball">${i}</div>`
          }
          balls += `<div class="countdown-ball rocket">🚀</div>`
          ballsContainer.innerHTML = balls
        }

        // 조건 표시 초기화
        const conditionResult = document.querySelector('#condition-result')
        if (conditionResult) {
          conditionResult.textContent = '🤔 실행 전'
          conditionResult.className = 'condition-result'
        }

        // 출력 초기화
        const outputDisplay = document.querySelector('#countdown-output-display')
        if (outputDisplay) {
          outputDisplay.innerHTML = '<span class="waiting">실행 버튼을 눌러보세요!</span>'
        }
      })
    }

    if (runCountdownDemo) {
      runCountdownDemo.addEventListener('click', async () => {
        countdownRunning = true
        countdownOutput = []
        countdownCurrent = countdownStart
        runCountdownDemo.disabled = true
        runCountdownDemo.textContent = '⏳ 카운트다운 중...'

        const outputDisplay = document.querySelector('#countdown-output-display')
        const conditionResult = document.querySelector('#condition-result')
        const ballsContainer = document.querySelector('#countdown-balls')
        if (outputDisplay) outputDisplay.innerHTML = ''

        // 카운트다운 애니메이션
        for (let count = countdownStart; count >= 0; count--) {
          countdownCurrent = count

          // 조건 상태 업데이트
          if (conditionResult) {
            if (count > 0) {
              conditionResult.textContent = `✅ ${count} > 0 → True (계속!)`
              conditionResult.className = 'condition-result true-state'
            } else {
              conditionResult.textContent = `❌ ${count} > 0 → False (종료!)`
              conditionResult.className = 'condition-result false-state'
            }
          }

          // 숫자 공 하이라이트
          if (ballsContainer) {
            const balls = ballsContainer.querySelectorAll('.countdown-ball')
            balls.forEach(ball => {
              ball.classList.remove('active', 'done')
              const ballValue = ball.textContent.trim()
              if (ballValue === String(count) || (ballValue === '🚀' && count === 0)) {
                ball.classList.add('active')
              }
              if (countdownOutput.includes(parseInt(ballValue)) || 
                  (countdownOutput.includes('🚀') && ballValue === '🚀')) {
                ball.classList.add('done')
              }
            })
          }

          await sleep(600)

          // 출력 추가
          if (count > 0) {
            countdownOutput.push(count)
            if (outputDisplay) {
              outputDisplay.innerHTML += `<span class="out-num pop-in">${count}</span>`
            }
          } else {
            // 발사!
            countdownOutput.push('🚀')
            if (outputDisplay) {
              outputDisplay.innerHTML += `<span class="out-num rocket-out pop-in">발사! 🚀</span>`
            }
          }
        }

        // 완료
        countdownRunning = false
        runCountdownDemo.disabled = false
        runCountdownDemo.textContent = '▶ 다시 시작!'
      })
    }

    // while문 활용 예시 카드
    whileExCards.forEach(card => {
      card.addEventListener('click', () => {
        const example = card.dataset.whileExample
        const demoArea = document.querySelector('#while-demo-area')
        if (!demoArea) return

        const examples = {
          password: {
            title: '🔐 비밀번호 맞추기',
            code: 'password = "1234"\nguess = ""\nwhile guess != password:\n    guess = input("비밀번호: ")\nprint("정답입니다!")',
            desc: '비밀번호가 맞을 때까지 계속 물어봐요'
          },
          sum: {
            title: '➕ 합계 계산',
            code: 'total = 0\nnum = 1\nwhile total < 100:\n    total = total + num\n    num = num + 1\nprint("합계:", total)',
            desc: '합계가 100 이상이 될 때까지 더해요'
          },
          guess: {
            title: '🎲 숫자 맞추기 게임',
            code: 'answer = 7\nguess = 0\nwhile guess != answer:\n    guess = int(input("숫자: "))\n    if guess < answer:\n        print("더 크게!")\n    elif guess > answer:\n        print("더 작게!")\nprint("정답!")',
            desc: '정답을 맞출 때까지 힌트를 줘요'
          }
        }

        const ex = examples[example]
        demoArea.innerHTML = `
          <div class="while-demo-content">
            <h5>${ex.title}</h5>
            <div class="demo-code">
              <pre>${ex.code}</pre>
            </div>
            <div class="demo-desc">
              💡 ${ex.desc}
            </div>
          </div>
        `
        demoArea.classList.add('show')
      })
    })

    // 소개 페이지 미니게임 이벤트
    const introClickBtn = document.querySelector('#intro-click-btn')
    const showMagicBtn = document.querySelector('#show-magic-btn')
    
    if (introClickBtn && introClicks < 10) {
      introClickBtn.addEventListener('click', () => {
        introClicks++
        // 버튼 효과
        introClickBtn.classList.add('clicked')
        setTimeout(() => introClickBtn.classList.remove('clicked'), 150)
        
        // 카운터 업데이트
        const counter = document.querySelector('.counter-num')
        if (counter) {
          counter.textContent = introClicks
          counter.classList.add('pulse')
          setTimeout(() => counter.classList.remove('pulse'), 300)
        }
        
        // 10번 완료시 전체 리렌더
        if (introClicks >= 10) {
          renderApp()
        }
      })
    }
    
    if (showMagicBtn) {
      showMagicBtn.addEventListener('click', () => {
        introShowMagic = true
        renderApp()
      })
    }

    // break/continue 실험 이벤트 핸들러
    const bcBlocks = document.querySelectorAll('.bc-block')
    const bcRunBtn = document.querySelector('#run-bc-experiment')
    
    bcBlocks.forEach(block => {
      block.addEventListener('click', () => {
        bcSelectedBlock = block.dataset.block
        bcOutput = []
        bcFeedback = ''
        bcHighlight = -1
        renderApp()
      })
    })
    
    if (bcRunBtn) {
      bcRunBtn.addEventListener('click', async () => {
        if (!bcSelectedBlock || bcRunning) return
        
        bcRunning = true
        bcOutput = []
        bcFeedback = ''
        
        // 버튼 비활성화
        bcRunBtn.disabled = true
        
        // 실험 실행
        for (let i = 0; i < 6; i++) {
          // for 문 줄 하이라이트
          bcHighlight = 0
          updateBcExperimentUI(i)
          await sleep(400)
          
          // if 조건 확인
          bcHighlight = 1
          updateBcExperimentUI(i)
          await sleep(400)
          
          if (i === 3) {
            // break 또는 continue 실행
            bcHighlight = 2
            updateBcExperimentUI(i)
            await sleep(500)
            
            if (bcSelectedBlock === 'break') {
              // break: 반복문 즉시 종료
              bcFeedback = 'i가 3이 되는 순간 반복문이 완전히 종료됩니다.'
              break
            } else {
              // continue: 이번 반복만 건너뜀
              bcFeedback = 'i가 3일 때만 출력이 생략되고 반복은 계속됩니다.'
              continue
            }
          }
          
          // print(i) 실행
          bcHighlight = 3
          updateBcExperimentUI(i)
          await sleep(300)
          bcOutput.push(String(i))
          updateBcExperimentUI(i)
          await sleep(200)
        }
        
        // 실행 완료
        bcHighlight = -1
        bcRunning = false
        renderApp()
      })
    }

    // 줄 토글 실험 이벤트 핸들러
    const togglePrint = document.querySelector('#toggle-print')
    const toggleIncrement = document.querySelector('#toggle-increment')
    const runExperimentBtn = document.querySelector('#run-experiment')
    
    if (togglePrint) {
      togglePrint.addEventListener('change', () => {
        experimentLines.print = togglePrint.checked
        // 체크 상태 바뀌면 결과 초기화
        experimentOutput = []
        experimentStep = 0
        experimentHighlight = -1
        renderApp()
      })
    }
    
    if (toggleIncrement) {
      toggleIncrement.addEventListener('change', () => {
        experimentLines.increment = toggleIncrement.checked
        // 체크 상태 바뀌면 결과 초기화
        experimentOutput = []
        experimentStep = 0
        experimentHighlight = -1
        renderApp()
      })
    }
    
if (runExperimentBtn) {
      runExperimentBtn.addEventListener('click', async () => {
        // 현재 체크박스 상태 다시 읽기
        const printChecked = document.querySelector('#toggle-print')?.checked ?? true
        const incrementChecked = document.querySelector('#toggle-increment')?.checked ?? true

        experimentRunning = true
        experimentOutput = []
        experimentStep = 0

        // 실행 시작 전 UI 업데이트
        const runBtn = document.querySelector('#run-experiment')
        if (runBtn) runBtn.disabled = true

        // while문 시뮬레이션
        let i = 0
        let loopCount = 0
        const maxLoops = 5 // 무한 루프 방지
        
        // 1. i = 0 초기화 줄
        experimentHighlight = 0
        updateExperimentUI(i)
        await sleep(500)
        
        // 2. while 루프 시작
        while (i < 3 && loopCount < maxLoops) {
          loopCount++
          
          // while 조건 줄 하이라이트
          experimentHighlight = 1
          updateExperimentUI(i)
          await sleep(400)
          
          // print(i) 줄 (체크된 경우만)
          if (printChecked) {
            experimentHighlight = 2
            updateExperimentUI(i)
            await sleep(400)
            experimentOutput.push(String(i))
            updateExperimentUI(i)
            await sleep(300)
          }
          
          // i += 1 줄 (체크된 경우만)
          if (incrementChecked) {
            experimentHighlight = 3
            i++ // 실제로 i 증가
            updateExperimentUI(i)
            await sleep(400)
          } else {
            // i += 1이 꺼져있으면 i가 증가하지 않음 - 무한 루프 시뮬레이션
            experimentHighlight = 3
            updateExperimentUI(i)
            await sleep(400)
            
            // 무한 루프 경고 메시지 추가
            if (loopCount >= maxLoops) {
              experimentOutput.push('⚠️ 무한 반복! (5회에서 멈춤)')
            }
          }
        }

        // 실행 완료
        experimentHighlight = -1
        experimentRunning = false
        experimentStep = 1
        renderApp()
      })
    }

    // 퀴즈 이벤트 핸들러
    const quizOptions = document.querySelectorAll('.quiz-option')
    quizOptions.forEach(option => {
      option.addEventListener('click', () => {
        const quizNum = option.dataset.quiz
        const isCorrect = option.dataset.correct === 'true'
        const feedbackEl = document.querySelector('#feedback-' + quizNum)
        const quizCard = document.querySelector('#quiz-' + quizNum)
        
        // 이미 답변한 경우 무시
        if (quizCard.classList.contains('answered')) return
        
        // 답변 완료 표시
        quizCard.classList.add('answered')
        option.classList.add(isCorrect ? 'correct' : 'wrong')
        
        // 정답인 경우 정답 버튼 표시
        if (!isCorrect) {
          const correctBtn = quizCard.querySelector('[data-correct="true"]')
          if (correctBtn) correctBtn.classList.add('correct')
        }
        
        // 피드백 표시
        const feedbacks = {
          '1': {
            correct: '✅ 정답! 언제 끝날지 모르는 상황에서는 while문!',
            wrong: '❌ 조건 기반의 while문이 더 적절해요.'
          },
          '2': {
            correct: '✅ 정답! break는 탈출, continue는 건너뛰기!',
            wrong: '❌ break가 완전 종료예요!'
          },
          '3': {
            correct: '✅ 정답! range(3)은 0, 1, 2!',
            wrong: '❌ range(n)은 0부터 n-1까지예요!'
          }
        }
        
        feedbackEl.innerHTML = isCorrect ? feedbacks[quizNum].correct : feedbacks[quizNum].wrong
        feedbackEl.className = 'quiz-feedback ' + (isCorrect ? 'correct' : 'wrong')

        // 이 카드가 정답인지 여부를 저장 (점수 계산용)
        quizCard.dataset.userCorrect = isCorrect ? 'true' : 'false'

        // 점수/메시지 업데이트
        const cards = document.querySelectorAll('.quiz-card')
        const total = cards.length
        let answered = 0
        let correctCount = 0

        cards.forEach(card => {
          if (card.classList.contains('answered')) {
            answered++
            // 사용자가 정답을 눌렀는지 여부는 카드에 플래그로 저장
            const userCorrect = card.dataset.userCorrect === 'true'
            if (userCorrect) {
              correctCount++
            }
          }
        })

        const scoreTextEl = document.querySelector('#quiz-score-text')
        const scoreMsgEl = document.querySelector('#quiz-score-message')
        const submitBtn = document.querySelector('#quiz-submit-btn')

        // 점수 업데이트
        quizScore.correctCount = correctCount
        quizScore.totalCount = total

        if (scoreTextEl) {
          scoreTextEl.textContent = `지금까지 맞힌 개수: ${correctCount} / ${total}`
        }

        if (scoreMsgEl) {
          if (answered === 0) {
            scoreMsgEl.textContent = '문제를 풀면서 개념을 정리해 보세요.'
          } else if (answered < total) {
            scoreMsgEl.textContent = `${correctCount}문제 맞았어요! 나머지도 도전해 볼까요?`
          } else {
            if (correctCount === total) {
              scoreMsgEl.textContent = '🎉 3/3 정답! 잘했어요! 반복문 개념이 아주 탄탄해요.'
            } else if (correctCount === 2) {
              scoreMsgEl.textContent = '👍 2문제 정답! 한 문제만 다시 복습해 보면 더 완벽해요.'
            } else {
              scoreMsgEl.textContent = '괜찮아요! 틀린 문제를 다시 보면서 개념을 한 번 더 정리해 봅시다.'
            }
          }
        }

        // 모든 문제를 풀었으면 제출 버튼 표시
        if (submitBtn && answered === total && !quizScore.submitted) {
          submitBtn.style.display = 'block'
        }
      })
    })

    // 퀴즈 제출 버튼
    const quizSubmitBtn = document.querySelector('#quiz-submit-btn')
    if (quizSubmitBtn) {
      quizSubmitBtn.addEventListener('click', async () => {
        if (quizScore.submitted) {
          alert('이미 제출하셨습니다.')
          return
        }

        try {
          const user = firebaseUser
          if (!user) {
            alert('로그인이 필요합니다.')
            return
          }

          // Firestore에 퀴즈 점수 저장
          if (db) {
            await addDoc(collection(db, 'quizScores'), {
              studentClass: studentInfo.klass || null,
              studentNumber: studentInfo.number || null,
              studentName: studentInfo.name || (firebaseUser?.displayName ?? null),
              email: firebaseUser?.email ?? null,
              correctCount: quizScore.correctCount,
              totalCount: quizScore.totalCount,
              score: Math.round((quizScore.correctCount / quizScore.totalCount) * 100),
              createdAt: serverTimestamp()
            })
          }

          quizScore.submitted = true
          quizSubmitBtn.textContent = '✅ 제출 완료'
          quizSubmitBtn.disabled = true
          alert(`퀴즈 제출이 완료되었습니다! (${quizScore.correctCount}/${quizScore.totalCount} 정답)`)
        } catch (err) {
          console.error('퀴즈 제출 중 오류:', err)
          alert('제출 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.')
        }
      })
    }
  }

  // 문제 페이지 이벤트
  if (currentPage === 'practice') {
    // 문제 페이지 이벤트 핸들러
    if (currentPage === 'practice') {
      attachPracticeEvents()
    }

    const practiceBtns = document.querySelectorAll('.practice-btn')
    practiceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code
        if (code) {
          miniEditorCode = code.replace(/\\n/g, '\n')
          
          // fakeInterpreter로 trace 생성
          const result = fakeInterpreter(miniEditorCode)
          if (result.trace?.length > 0) {
            miniStepTrace = result.trace
            miniStepIndex = 0
            miniStepMode = true
            miniEditorOpen = true
            miniEditorMinimized = false
            renderApp()
          }
        }
      })
    })
  }
  
// 프로젝트 페이지 이벤트
  if (currentPage === 'project') {
    // 레벨 선택 버튼
    const levelCards = document.querySelectorAll('.level-card')
    levelCards.forEach(card => {
      card.addEventListener('click', () => {
        projectLevel = card.dataset.level
        projectCode = ''
        projectRuleExplanation = ''
        renderApp()
      })
    })
    
    // 레벨 변경 버튼
    const changeLevelBtn = document.querySelector('#change-level')
    if (changeLevelBtn) {
      changeLevelBtn.addEventListener('click', () => {
        projectLevel = null
        projectCode = ''
        projectRuleExplanation = ''
        renderApp()
      })
    }
    
    // 코드 입력
    const codeInput = document.querySelector('#project-code')
    if (codeInput) {
      codeInput.addEventListener('input', () => {
        projectCode = codeInput.value
      })
      
      // 자동 들여쓰기
      codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const start = codeInput.selectionStart
          const value = codeInput.value
          const beforeCursor = value.substring(0, start)
          const currentLineStart = beforeCursor.lastIndexOf('\n') + 1
          const currentLine = beforeCursor.substring(currentLineStart)
          const indentMatch = currentLine.match(/^(\s*)/)
          let indent = indentMatch ? indentMatch[1] : ''
          if (currentLine.trimEnd().endsWith(':')) {
            indent += '    '
          }
          const newValue = value.substring(0, start) + '\n' + indent + value.substring(codeInput.selectionEnd)
          codeInput.value = newValue
          const newCursorPos = start + 1 + indent.length
          codeInput.selectionStart = newCursorPos
          codeInput.selectionEnd = newCursorPos
          projectCode = codeInput.value
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          const start = codeInput.selectionStart
          const value = codeInput.value
          codeInput.value = value.substring(0, start) + '    ' + value.substring(codeInput.selectionEnd)
          codeInput.selectionStart = codeInput.selectionEnd = start + 4
          projectCode = codeInput.value
        }
      })
    }
    
    // 규칙 설명 입력
    const ruleInput = document.querySelector('#rule-explanation')
    if (ruleInput) {
      ruleInput.addEventListener('input', () => {
        projectRuleExplanation = ruleInput.value
      })
    }

    // 프로젝트 코드 실행 버튼 (실행 결과만 보기)
    const projectRunCodeBtn = document.querySelector('#project-run-code')
    if (projectRunCodeBtn) {
      projectRunCodeBtn.addEventListener('click', async () => {
        const codeInputEl = document.querySelector('#project-code')
        const outputEl = document.querySelector('#project-output')
        if (!codeInputEl || !outputEl) return

        const code = codeInputEl.value || ''
        if (!code.trim()) {
          outputEl.textContent = '코드를 입력해 주세요.'
          return
        }

        outputEl.textContent = '실행 중...'

        try {
          if (typeof window.Sk === 'undefined') {
            outputEl.textContent = '❌ Skulpt가 로드되지 않았습니다. 페이지를 새로고침해 주세요.'
            return
          }

          const Sk = window.Sk
          let outputText = ''

          Sk.configure({
            output: (text) => {
              outputText += text
            },
            read: (x) => {
              if (Sk.builtinFiles && Sk.builtinFiles.files && Sk.builtinFiles.files[x]) {
                return Sk.builtinFiles.files[x]
              }
              throw 'File not found: ' + x
            }
          })

          const compiled = Sk.importMainWithBody('<stdin>', false, code)
          if (compiled && compiled.then) {
            await compiled
          }

          outputEl.textContent = outputText.trim() || '(출력 없음)'
        } catch (err) {
          outputEl.textContent = `오류: ${err.toString()}`
        }
      })
    }

    // 실행 흐름 보기/수정하기 토글 버튼
    const runBtn = document.querySelector('#run-project')
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        if (projectShowTrace) {
          // 코드 수정 모드로 전환
          projectShowTrace = false
          renderApp()
        } else {
          // 실행 흐름 보기 모드로 전환
          const code = document.querySelector('#project-code')?.value || projectCode
          projectCode = code
          const result = fakeInterpreter(code)
          if (result.trace?.length > 0) {
            projectTrace = result.trace
            projectTraceIndex = 0
            projectShowTrace = true
            renderApp()
          } else {
            alert('⚠️ 실행할 반복문이 없어요!\n\nfor 또는 while문을 포함해주세요.')
          }
        }
      })
    }
    
// 실행 흐름 컨트롤 버튼들
    const traceFirstBtn = document.querySelector('#trace-first')
    const tracePrevBtn = document.querySelector('#trace-prev')
    const traceNextBtn = document.querySelector('#trace-next')
    const traceLastBtn = document.querySelector('#trace-last')

    if (traceFirstBtn) {
      traceFirstBtn.addEventListener('click', (e) => {
        e.preventDefault()
        projectTraceIndex = 0
        updateProjectTraceUI()
      })
    }
    if (tracePrevBtn) {
      tracePrevBtn.addEventListener('click', (e) => {
        e.preventDefault()
        if (projectTraceIndex > 0) {
          projectTraceIndex--
          updateProjectTraceUI()
        }
      })
    }
    if (traceNextBtn) {
      traceNextBtn.addEventListener('click', (e) => {
        e.preventDefault()
        if (projectTraceIndex < projectTrace.length - 1) {
          projectTraceIndex++
          updateProjectTraceUI()
        }
      })
    }
    if (traceLastBtn) {
      traceLastBtn.addEventListener('click', (e) => {
        e.preventDefault()
        projectTraceIndex = projectTrace.length - 1
        updateProjectTraceUI()
      })
    }

    // 코드 초기화 버튼
    const resetBtn = document.querySelector('#reset-code')
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        projectCode = ''
        projectShowTrace = false
        projectTrace = []
        projectTraceIndex = 0
        renderApp()
      })
    }

    // 프로젝트 제출 버튼 → 수업 성찰 페이지로 이동
    const projectSubmitBtn = document.querySelector('#project-submit')
    if (projectSubmitBtn) {
      projectSubmitBtn.addEventListener('click', () => {
        const codeEl = document.querySelector('#project-code')
        const ruleEl = document.querySelector('#rule-explanation')
        if (codeEl) projectCode = codeEl.value
        if (ruleEl) projectRuleExplanation = ruleEl.value

        // 나중에 교사용 모니터링에서 활용할 수 있도록 상태만 보존하고 페이지 이동
        currentPage = 'reflection'
        renderApp()
      })
    }
  }

  // 실행 흐름 페이지 (ACE Editor + Skulpt 방식)
  if (currentPage === 'trace') {
  const resetBtn = document.querySelector('#btn-reset')
    const runPythonBtn = document.querySelector('#btn-run-python')
    const stepStartBtn = document.querySelector('#btn-step-start')
    const editorHost = document.querySelector('#code-editor')

    // ACE Editor 초기화
    if (editorHost && typeof ace !== 'undefined') {
      // 에디터가 없거나 DOM 요소가 변경된 경우 재초기화
      if (!traceEditor || traceEditor.container !== editorHost) {
        // 기존 에디터가 있으면 제거
        if (traceEditor) {
          traceEditor.destroy()
        }
        traceEditor = ace.edit(editorHost)
        traceEditor.setTheme('ace/theme/monokai')
        traceEditor.session.setMode('ace/mode/python')
        traceEditor.setValue(pythonCode || starterCode)
        traceEditor.setOptions({
          fontSize: 16,
          fontFamily: 'Consolas, Monaco, monospace',
          tabSize: 4,
          useSoftTabs: true,
          wrap: true,
          showPrintMargin: false,
          readOnly: false
        })
      } else {
        // 에디터가 이미 있으면 값만 업데이트
        traceEditor.setValue(pythonCode || starterCode)
      }
    } else if (editorHost && typeof ace === 'undefined') {
      // ACE Editor가 로드되지 않은 경우 textarea 폴백
      if (!editorHost.querySelector('textarea')) {
        const textarea = document.createElement('textarea')
        textarea.style.width = '100%'
        textarea.style.height = '400px'
        textarea.style.fontFamily = 'monospace'
        textarea.style.padding = '10px'
        textarea.value = pythonCode || starterCode
        editorHost.innerHTML = ''
        editorHost.appendChild(textarea)
      }
    }

    // 예제 불러오기
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        pythonCode = starterCode
        pythonStepMode = false
        pythonStepIndex = -1
        latestTrace = []
        lastValidPythonCode = ''
        if (traceEditor) {
          traceEditor.setValue(pythonCode)
        }
        const errorSection = document.querySelector('#error-section')
        const errorDisplay = document.querySelector('#error-display')
        const runSection = document.querySelector('#python-run-section')
        const runOutput = document.querySelector('#python-run-output')
        if (errorSection) errorSection.style.display = 'none'
        if (errorDisplay) errorDisplay.textContent = ''
        if (runSection) runSection.style.display = 'none'
        if (runOutput) runOutput.textContent = ''
      })
    }

    // [▶ 파이썬 실행] Skulpt로 실제 파이썬 실행
    if (runPythonBtn) {
      runPythonBtn.addEventListener('click', () => {
        let code = ''
        if (traceEditor) {
          code = traceEditor.getValue()
        } else if (editorHost) {
          const textarea = editorHost.querySelector('textarea')
          if (textarea) {
            code = textarea.value
          } else {
            code = pythonCode || starterCode
          }
        } else {
          code = pythonCode || starterCode
        }
        pythonCode = code

        const runSection = document.querySelector('#python-run-section')
        const runOutput = document.querySelector('#python-run-output')
        const errorSection = document.querySelector('#error-section')
        const errorDisplay = document.querySelector('#error-display')

        if (errorSection) errorSection.style.display = 'none'
        if (errorDisplay) errorDisplay.textContent = ''
        if (runSection) runSection.style.display = 'block'
        if (runOutput) runOutput.textContent = '실행 중...'

        try {
          if (typeof window.Sk === 'undefined') {
            if (runOutput) runOutput.textContent = '❌ Skulpt가 로드되지 않았습니다. 페이지를 새로고침해 주세요.'
            return
          }

          const Sk = window.Sk
          let outputText = ''

          Sk.configure({
            output: (text) => {
              outputText += text
            },
            read: (x) => {
              if (Sk.builtinFiles && Sk.builtinFiles.files && Sk.builtinFiles.files[x]) {
                return Sk.builtinFiles.files[x]
              }
              throw 'File not found: \'' + x + '\''
            }
          })

          const compiled = Sk.importMainWithBody('<stdin>', false, code)
          
          if (compiled && compiled.then) {
            compiled.then(() => {
              if (runOutput) {
                if (outputText.trim()) {
                  runOutput.textContent = outputText
        } else {
                  runOutput.textContent = '(출력 없음)'
                }
              }
            }).catch((err) => {
              let errorMsg = ''
              if (err.traceback) {
                errorMsg = err.traceback.toString()
              } else if (err.toString) {
                errorMsg = err.toString()
              } else {
                errorMsg = String(err)
              }
              if (runOutput) {
                runOutput.textContent = `❌ 오류 발생:\n${errorMsg}`
              }
            })
          } else {
            if (runOutput) {
              if (outputText.trim()) {
                runOutput.textContent = outputText
              } else {
                runOutput.textContent = '(출력 없음)'
              }
            }
        }
      } catch (err) {
          let errorMsg = ''
          if (err.traceback) {
            errorMsg = err.traceback.toString()
          } else if (err.toString) {
            errorMsg = err.toString()
          } else {
            errorMsg = String(err)
          }

          if (runOutput) {
            runOutput.textContent = `❌ 오류 발생:\n${errorMsg}`
          }
        }
      })
    }

    // [👣 실행 흐름 보기] trace 실행 (파이썬 실행과 분리)
    if (stepStartBtn) {
      stepStartBtn.addEventListener('click', () => {
        const code = traceEditor ? traceEditor.getValue() : (pythonCode || starterCode)
        pythonCode = code

        const errorSection = document.querySelector('#error-section')
        const errorDisplay = document.querySelector('#error-display')
        if (errorSection) errorSection.style.display = 'none'
        if (errorDisplay) errorDisplay.textContent = ''

        const syntaxCheck = checkPythonSyntax(code)
        if (!syntaxCheck.valid) {
          if (errorSection) errorSection.style.display = 'block'
          if (errorDisplay) {
            let msg = syntaxCheck.error || '문법 오류가 발생했습니다.'
            if (syntaxCheck.lineNum) {
              msg = `줄 ${syntaxCheck.lineNum}: ${msg}`
            }

            let hint = ''
            const lower = msg.toLowerCase()
            if (syntaxCheck.type === 'SyntaxError' || lower.includes('syntaxerror')) {
              hint = '힌트: 콜론(:)이나 괄호가 빠지지 않았는지 확인해 보세요.'
            } else if (syntaxCheck.type === 'IndentationError' || lower.includes('indentationerror')) {
              hint = '힌트: 들여쓰기가 일정한지, 같은 블록의 줄들이 같은 칸수만큼 띄워졌는지 확인해 보세요.'
            } else if (syntaxCheck.type === 'NameError' || lower.includes('nameerror')) {
              hint = '힌트: 변수를 사용하기 전에 먼저 값을 넣어 주었는지(선언했는지) 확인해 보세요.'
            }

            errorDisplay.textContent = hint ? `${msg}\n${hint}` : msg
          }
          lastValidPythonCode = ''
          return
        }

        lastValidPythonCode = code

        const result = fakeInterpreter(code)

        if (result.trace.length > 0) {
          const hasLoop = result.trace.some(t => t.type === 'for' || t.type === 'for-end' || t.type === 'while' || t.type === 'while-end')
          if (!hasLoop) {
            if (errorSection) errorSection.style.display = 'block'
            if (errorDisplay) {
              errorDisplay.textContent = '반복문(for 또는 while)이 포함된 코드를 입력해주세요.'
            }
            return
          }

          latestTrace = result.trace
          pythonStepMode = true
          pythonStepIndex = 0
          renderApp()
        } else {
          if (errorSection) errorSection.style.display = 'block'
          if (errorDisplay) {
            errorDisplay.textContent = '실행할 반복문이 없어요. for 또는 while문을 포함해주세요.'
          }
        }
      })
    }

    // 스텝 컨트롤 버튼들
    const stepFirstBtn = document.querySelector('#btn-step-first')
    const stepPrevBtn = document.querySelector('#btn-step-prev')
    const stepNextBtn = document.querySelector('#btn-step-next')
    const stepExitBtn = document.querySelector('#btn-step-exit')

    // DOM 직접 업데이트 함수 (페이지 전체 다시 렌더링 안 함!)
    const updateStepUI = () => {
      const currentStep = latestTrace[pythonStepIndex]
      if (!currentStep) return
      
      // 1. 테이블에 새 행 추가
      const tbody = document.querySelector('#trace-tbody')
      const tableWrap = document.querySelector('#trace-table-wrap')
      
      if (tbody) {
        // 기존 current 클래스 제거
        tbody.querySelectorAll('tr.current').forEach(r => {
          r.classList.remove('current', 'new-row')
          r.classList.add('executed')
        })
        
        // 이미 있는 행인지 확인
        const existingRow = tbody.querySelector(`tr[data-step="${pythonStepIndex}"]`)
        
        if (!existingRow) {
          // 새 행 추가
          const t = currentStep
          const newRow = document.createElement('tr')
          newRow.className = `current new-row ${t.type}`
          newRow.dataset.step = pythonStepIndex
          newRow.innerHTML = `
            <td class="step-num">${t.step}</td>
            <td class="line-num">${t.lineNum}</td>
            <td class="iteration">${t.iteration !== null ? `${t.iteration}/${t.totalIterations}` : '-'}</td>
            <td class="code-cell"><code>${t.code}</code></td>
            <td class="vars-cell">${Object.entries(t.variables).map(([k,v]) => `<span class="var-chip">${k}=${v}</span>`).join(' ') || '-'}</td>
            <td class="output-cell">${t.output !== null ? `<span class="output-chip">"${t.output}"</span>` : '-'}</td>
          `
          tbody.appendChild(newRow)
          
          // 테이블 컨테이너 내에서만 스크롤 (페이지 스크롤 X)
          if (tableWrap) {
            tableWrap.scrollTop = tableWrap.scrollHeight
          }
        } else {
          existingRow.classList.add('current')
          existingRow.classList.remove('executed')
          // 테이블 내에서만 스크롤
          if (tableWrap) {
            const rowTop = existingRow.offsetTop - tableWrap.offsetTop
            tableWrap.scrollTop = rowTop - tableWrap.clientHeight / 2
          }
        }
      }
      
      // 2. 코드 하이라이트 업데이트
      document.querySelectorAll('.code-row').forEach(row => {
        const lineNum = parseInt(row.querySelector('.line-number')?.textContent)
        row.classList.remove('active', 'executed')
        if (lineNum === currentStep.lineNum) {
          row.classList.add('active')
        } else {
          // 현재 단계 이전에 실행된 줄은 executed 표시
          const executedBefore = latestTrace.slice(0, pythonStepIndex).some(t => t.lineNum === lineNum)
          if (executedBefore) {
            row.classList.add('executed')
          }
        }
      })
      
      // 3. 변수 상태 업데이트
      const variablesDisplay = document.querySelector('#variables-display')
      if (variablesDisplay && currentStep.variables) {
        const vars = currentStep.variables
        if (Object.keys(vars).length > 0) {
          variablesDisplay.innerHTML = Object.entries(vars)
            .map(([k, v]) => `<div class="var-item"><span class="var-name">${k}</span> = <span class="var-value">${v}</span></div>`)
            .join('')
        } else {
          variablesDisplay.innerHTML = '<span class="muted">아직 변수가 없어요</span>'
        }
      }
      
      // 4. 출력 업데이트 (end 파라미터 고려해서 한 줄로 합침)
      const outputDisplay = document.querySelector('#output-display')
      if (outputDisplay) {
        // 전체 출력 다시 계산 (end 파라미터 고려)
        const outputLines = []
        let currentLine = ''
        for (let i = 0; i <= pythonStepIndex && i < latestTrace.length; i++) {
          const t = latestTrace[i]
          if (t.output !== null) {
            currentLine += t.output
            if (t.endChar === '\n' || t.endChar === undefined) {
              outputLines.push(currentLine)
              currentLine = ''
            } else {
              currentLine += t.endChar
            }
          }
        }
        if (currentLine) {
          outputLines.push(currentLine)
        }
        
        // 출력 표시 업데이트
        if (outputLines.length > 0) {
          outputDisplay.innerHTML = outputLines.map(o => `<div class="output-line">${o}</div>`).join('')
        } else {
          outputDisplay.innerHTML = '<span class="muted">아직 출력이 없어요</span>'
        }
      }
      
      // 5. 단계 정보 업데이트
      const stepBadge = document.querySelector('.step-badge-big')
      const stepDesc = document.querySelector('.step-description')
      const iterBadge = document.querySelector('.iteration-badge')
      
      if (stepBadge) stepBadge.textContent = `${currentStep.step} / ${latestTrace.length}`
      if (stepDesc) stepDesc.textContent = currentStep.description
      if (iterBadge) {
        if (currentStep.iteration) {
          iterBadge.textContent = `🔄 ${currentStep.iteration}번째 반복 중`
          iterBadge.style.display = 'inline-block'
        } else {
          iterBadge.style.display = 'none'
        }
      }
      
      // 6. 버튼 상태 업데이트
      const prevBtn = document.querySelector('#btn-step-prev')
      const firstBtn = document.querySelector('#btn-step-first')
      const nextBtn = document.querySelector('#btn-step-next')
      
      if (prevBtn) prevBtn.disabled = pythonStepIndex <= 0
      if (firstBtn) firstBtn.disabled = pythonStepIndex <= 0
      if (nextBtn) {
        const isFinished = pythonStepIndex >= latestTrace.length - 1
        nextBtn.disabled = isFinished
        nextBtn.innerHTML = isFinished ? '✅ 완료!' : '다음 ▶️'
      }
    }

    if (stepFirstBtn) {
      stepFirstBtn.addEventListener('click', (e) => {
        e.preventDefault()
        pythonStepIndex = 0
        updateStepUI()
      })
    }

    if (stepPrevBtn) {
      stepPrevBtn.addEventListener('click', (e) => {
        e.preventDefault()
        if (pythonStepIndex > 0) {
          pythonStepIndex--
          updateStepUI()
        }
      })
    }

    if (stepNextBtn) {
      stepNextBtn.addEventListener('click', (e) => {
        e.preventDefault() // 페이지 스크롤 방지
        if (pythonStepIndex < latestTrace.length - 1) {
          pythonStepIndex++
          updateStepUI() // DOM만 업데이트! 🚀
        }
      })
    }

    if (stepExitBtn) {
      stepExitBtn.addEventListener('click', () => {
        pythonStepMode = false
        pythonStepIndex = -1
        latestTrace = []
        renderApp()
      })
    }

    // 코드 입력 시 저장
    if (input) {
      // 자동 들여쓰기 (Enter 시 이전 줄 들여쓰기 유지 + : 뒤 추가 들여쓰기)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          
          const start = input.selectionStart
          const end = input.selectionEnd
          const value = input.value
          
          // 현재 줄 찾기
          const beforeCursor = value.substring(0, start)
          const currentLineStart = beforeCursor.lastIndexOf('\n') + 1
          const currentLine = beforeCursor.substring(currentLineStart)
          
          // 현재 줄의 들여쓰기 추출
          const indentMatch = currentLine.match(/^(\s*)/)
          let indent = indentMatch ? indentMatch[1] : ''
          
          // 콜론(:)으로 끝나면 추가 들여쓰기
          if (currentLine.trimEnd().endsWith(':')) {
            indent += '    '
          }
          
          // 새 줄 삽입
          const newValue = value.substring(0, start) + '\n' + indent + value.substring(end)
          input.value = newValue
          
          // 커서 위치 조정
          const newCursorPos = start + 1 + indent.length
          input.selectionStart = newCursorPos
          input.selectionEnd = newCursorPos
          
          // 상태 업데이트
          pythonCode = input.value
        }
        
        // Tab 키로 들여쓰기
        if (e.key === 'Tab') {
          e.preventDefault()
          const start = input.selectionStart
          const end = input.selectionEnd
          const value = input.value
          
          input.value = value.substring(0, start) + '    ' + value.substring(end)
          input.selectionStart = input.selectionEnd = start + 4
          
          pythonCode = input.value
        }
      })
      
      input.addEventListener('input', () => {
        pythonCode = input.value
      })
    }
  }

  // 수업 후기 / 챗봇 + 그림 페이지 이벤트
  if (currentPage === 'reflection') {
    const sendChatBtn = document.querySelector('#send-chat')
    const chatInput = document.querySelector('#chat-input')

    const sendMessage = async () => {
      const message = chatInput.value.trim()
      if (!message) return

      chatMessages.push({ role: 'user', content: message })
      chatInput.value = ''
      renderApp()

      const messagesDiv = document.querySelector('#chat-messages')
      if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight

      // 로딩 표시
      const loadingMsg = document.createElement('div')
      loadingMsg.className = 'chat-message assistant loading'
      loadingMsg.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-bubble">생각 중... 💭</div>
        </div>
      `
      messagesDiv?.appendChild(loadingMsg)

      const response = await sendToChatGPT(message)
      chatMessages.push({ role: 'assistant', content: response })
      renderApp()

      const newMessagesDiv = document.querySelector('#chat-messages')
      if (newMessagesDiv) newMessagesDiv.scrollTop = newMessagesDiv.scrollHeight
    }

    if (sendChatBtn && chatInput) {
      sendChatBtn.addEventListener('click', sendMessage)
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          sendMessage()
        }
      })
    }

    // 빠른 답변 칩
    const quickChips = document.querySelectorAll('.quick-chip')
    quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.dataset.msg
        if (chatInput) {
          chatInput.value = msg
          chatInput.focus()
        }
      })
    })

    // 그림 그리기 캔버스
    const canvas = document.querySelector('#reflection-canvas')
    const colorInput = document.querySelector('#draw-color')
    const sizeInput = document.querySelector('#draw-size')
    const clearBtn = document.querySelector('#draw-clear')

    if (canvas && canvas.getContext) {
      const ctx = canvas.getContext('2d')
      let drawing = false
      let lastX = 0
      let lastY = 0

      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect()
        const clientX = e.touches ? e.touches[0].clientX : e.clientX
        const clientY = e.touches ? e.touches[0].clientY : e.clientY
        return {
          x: clientX - rect.left,
          y: clientY - rect.top
        }
      }

      const startDraw = (e) => {
        drawing = true
        const pos = getPos(e)
        lastX = pos.x
        lastY = pos.y
      }

      const draw = (e) => {
        if (!drawing) return
        e.preventDefault()
        const pos = getPos(e)
        ctx.strokeStyle = colorInput?.value || '#2563eb'
        ctx.lineWidth = sizeInput ? Number(sizeInput.value) : 4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        ctx.beginPath()
        ctx.moveTo(lastX, lastY)
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()

        lastX = pos.x
        lastY = pos.y
      }

      const endDraw = () => {
        drawing = false
      }

      canvas.addEventListener('mousedown', startDraw)
      canvas.addEventListener('mousemove', draw)
      canvas.addEventListener('mouseup', endDraw)
      canvas.addEventListener('mouseleave', endDraw)

      canvas.addEventListener('touchstart', startDraw, { passive: false })
      canvas.addEventListener('touchmove', draw, { passive: false })
      canvas.addEventListener('touchend', endDraw)

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        })
      }
    }

    // 제출하기 버튼 (나중에 Firebase 전송 예정)
    const submitBtn = document.querySelector('#submit-reflection')
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        try {
          const user = firebaseUser
          const now = Date.now()
          const projectElapsedMs = projectStartTime && projectSubmitTime ? (projectSubmitTime - projectStartTime) : null
          const reflectionElapsedMs = reflectionStartTime ? (now - reflectionStartTime) : null

          // 그림을 JPG로 변환하여 Storage에 저장
          let drawingUrl = null
          const canvas = document.querySelector('#reflection-canvas')
          if (canvas) {
            try {
              // canvas를 JPG로 변환 (quality: 0.9)
              const dataURL = canvas.toDataURL('image/jpeg', 0.9)
              
              // base64를 blob으로 변환
              const response = await fetch(dataURL)
              const blob = await response.blob()
              
              // Storage에 업로드
              if (user && blob.size > 0) {
                const fileName = `drawings/${user.uid}/${now}.jpg`
                const ref = storageRef(storage, fileName)
                await uploadBytes(ref, blob, { contentType: 'image/jpeg' })
                
                // 다운로드 URL 생성 (필요시)
                // drawingUrl = await getDownloadURL(ref)
                drawingUrl = fileName // 경로 저장
              }
            } catch (drawErr) {
              console.warn('그림 저장 실패 (무시됨):', drawErr)
            }
          }

          // Firestore에 성찰 데이터 저장 (프로젝트 코드는 문자열로 직접 저장)
          if (db) {
            await addDoc(collection(db, 'reflections'), {
              studentClass: studentInfo.klass || null,
              studentNumber: studentInfo.number || null,
              studentName: studentInfo.name || (firebaseUser?.displayName ?? null),
              email: firebaseUser?.email ?? null,
              projectLevel: projectLevel,
              projectElapsedMs,
              reflectionElapsedMs,
              chatMessages,
              // 프로젝트 코드를 문자열로 직접 저장 (UTF-8, 한글 주석 보존)
              projectCode: projectCode || null,
              // 프로젝트 규칙 설명 저장
              projectRuleExplanation: projectRuleExplanation || null,
              // 그림 URL 저장
              drawingUrl: drawingUrl,
              createdAt: serverTimestamp()
            })
          }

          alert('제출이 완료되었습니다! (Firebase에 저장되었습니다.)')
        } catch (err) {
          console.error('성찰 제출 중 오류:', err)
          alert('제출 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.')
        }
      })
    }
  }
}

// 앱 시작
renderApp()
checkApiKey() // API 키 확인
