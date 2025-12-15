import './style.css'

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

const renderNavigation = () => {
  return `
    <nav class="cute-nav">
      <div class="nav-left">
        <div class="nav-logo" id="go-home" style="cursor: pointer;">
          <span class="logo-icon">🐍</span>
          <span class="logo-text">반복문 학습</span>
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
        <h1 class="intro-title">Python 반복문 학습</h1>
        <p class="intro-subtitle">for문과 while문을 완벽하게 이해해보자!</p>
        
        <div class="intro-learning-path">
          <div class="path-title">📍 학습 흐름</div>
          <div class="path-steps">
            <div class="path-step">
              <span class="step-num">1</span>
              <span class="step-text">개념 이해</span>
            </div>
            <div class="path-arrow">→</div>
            <div class="path-step">
              <span class="step-num">2</span>
              <span class="step-text">실행 흐름</span>
            </div>
            <div class="path-arrow">→</div>
            <div class="path-step">
              <span class="step-num">3</span>
              <span class="step-text">문제 풀이</span>
            </div>
            <div class="path-arrow">→</div>
            <div class="path-step">
              <span class="step-num">4</span>
              <span class="step-text">프로젝트</span>
            </div>
            <div class="path-arrow">→</div>
            <div class="path-step">
              <span class="step-num">5</span>
              <span class="step-text">성찰</span>
            </div>
          </div>
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
        
        <button class="intro-btn" id="start-btn">
          <span>학습 시작하기</span>
          <span class="btn-arrow">→</span>
        </button>
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
  { id: 5, title: '퀴즈', icon: '✅', short: '퀴즈' }
]

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
    case 5: return renderStep5Quiz()
    default: return renderStep0Intro()
  }
}

// Step 0: 반복문 소개
const renderStep0Intro = () => `
  <div class="step-card intro-step">
    <div class="step-header">
      <div class="step-emoji">💡</div>
      <h2>반복문이 왜 필요할까요?</h2>
    </div>
    
    <div class="intro-scenario">
      <div class="scenario-icon">🌅</div>
      <div class="scenario-text">
        <p>상상해보세요. 여러분이 <strong>"안녕하세요!"</strong>를 100번 출력해야 한다면?</p>
      </div>
    </div>
    
    <div class="code-battle">
      <div class="battle-side bad">
        <div class="battle-label">😫 반복문 없이</div>
        <pre class="battle-code">print("안녕하세요!")
print("안녕하세요!")
print("안녕하세요!")
print("안녕하세요!")
print("안녕하세요!")
... (95줄 더 작성해야 해요!)</pre>
        <div class="battle-result">❌ 100줄 필요</div>
      </div>
      
      <div class="battle-vs">VS</div>
      
      <div class="battle-side good">
        <div class="battle-label">😎 반복문 사용</div>
        <pre class="battle-code">for i in range(100):
    print("안녕하세요!")</pre>
        <div class="battle-result">✅ 단 2줄!</div>
      </div>
    </div>
    
    <div class="benefit-cards">
      <div class="benefit-card">
        <span class="benefit-icon">📝</span>
        <span>코드가 짧아져요</span>
      </div>
      <div class="benefit-card">
        <span class="benefit-icon">🔧</span>
        <span>수정이 쉬워요</span>
      </div>
      <div class="benefit-card">
        <span class="benefit-icon">🎯</span>
        <span>실수가 줄어들어요</span>
      </div>
    </div>
    
    <div class="step-tip">
      <strong>💡 핵심:</strong> 반복문은 같은 작업을 여러 번 할 때 사용해요!
    </div>
  </div>
`

// Step 1: for문
const renderStep1For = () => `
  <div class="step-card for-step">
    <div class="step-header">
      <div class="step-emoji">🔁</div>
      <h2>for문 - 횟수가 정해진 반복</h2>
    </div>
    
    <div class="syntax-highlight">
      <div class="syntax-title">📖 기본 구조</div>
      <pre class="syntax-code-big">for 변수 in range(반복횟수):
    반복할 코드</pre>
    </div>
    
    <div class="range-visual">
      <h4>🎯 range() 이해하기</h4>
      <div class="range-examples">
        <div class="range-ex">
          <code>range(5)</code>
          <div class="range-values">
            <span class="val">0</span>
            <span class="val">1</span>
            <span class="val">2</span>
            <span class="val">3</span>
            <span class="val">4</span>
          </div>
          <small>0부터 4까지 (5개)</small>
        </div>
        <div class="range-ex">
          <code>range(1, 6)</code>
          <div class="range-values">
            <span class="val">1</span>
            <span class="val">2</span>
            <span class="val">3</span>
            <span class="val">4</span>
            <span class="val">5</span>
          </div>
          <small>1부터 5까지</small>
        </div>
      </div>
    </div>
    
    <div class="example-cards">
      <div class="example-card" data-code="for i in range(1, 6):\\n    print(i)">
        <h5>🎮 예제: 1부터 5까지 출력</h5>
        <pre class="example-code">for i in range(1, 6):
    print(i)</pre>
        <div class="example-output">출력: 1 2 3 4 5</div>
        <button class="btn mini accent try-code-btn">🔍 실행 흐름 보기</button>
      </div>
    </div>
    
    <div class="step-tip">
      <strong>💡 기억하세요:</strong> range(n)은 0부터 시작해서 n-1까지!
    </div>
  </div>
`

// Step 2: while문
const renderStep2While = () => `
  <div class="step-card while-step">
    <div class="step-header">
      <div class="step-emoji">🔄</div>
      <h2>while문 - 조건이 참인 동안 반복</h2>
    </div>
    
    <div class="vs-comparison">
      <div class="vs-item for-side">
        <h4>🔁 for문</h4>
        <p><strong>"5번"</strong> 반복해줘</p>
        <small>횟수가 정해져 있을 때</small>
      </div>
      <div class="vs-badge">VS</div>
      <div class="vs-item while-side">
        <h4>🔄 while문</h4>
        <p><strong>"맞출 때까지"</strong> 반복해줘</p>
        <small>조건이 중요할 때</small>
      </div>
    </div>
    
    <div class="syntax-highlight">
      <div class="syntax-title">📖 기본 구조</div>
      <pre class="syntax-code-big">while 조건:
    반복할 코드
    조건을 변경하는 코드  # 중요!</pre>
    </div>
    
    <div class="example-cards">
      <div class="example-card">
        <h5>🚀 예제: 카운트다운</h5>
        <pre class="example-code">count = 5
while count > 0:
    print(count)
    count = count - 1
print("발사! 🚀")</pre>
        <div class="example-output">출력: 5 4 3 2 1 발사! 🚀</div>
      </div>
    </div>
    
    <div class="warning-box-inline">
      <span class="warning-icon">⚠️</span>
      <div>
        <strong>무한 루프 주의!</strong>
        <p>조건이 False가 되지 않으면 영원히 반복해요!</p>
      </div>
    </div>
  </div>
`

// Step 3: break/continue
const renderStep3Break = () => `
  <div class="step-card break-step">
    <div class="step-header">
      <div class="step-emoji">🚦</div>
      <h2>break & continue</h2>
    </div>
    
    <div class="bc-cards">
      <div class="bc-card-big break-card">
        <div class="bc-header">
          <span class="bc-icon-big">🛑</span>
          <h3>break</h3>
        </div>
        <p class="bc-meaning">반복문을 <strong>완전히 탈출</strong>해요</p>
        <pre class="bc-code-big">for i in range(10):
    if i == 5:
        break  # 여기서 멈춤!
    print(i)</pre>
        <div class="bc-result">
          <span class="result-label">출력:</span>
          <span class="result-values">0 1 2 3 4</span>
        </div>
        <div class="bc-analogy">🚪 "이제 그만! 나갈래!"</div>
      </div>
      
      <div class="bc-card-big continue-card">
        <div class="bc-header">
          <span class="bc-icon-big">⏭️</span>
          <h3>continue</h3>
        </div>
        <p class="bc-meaning">현재 반복만 <strong>건너뛰기</strong>해요</p>
        <pre class="bc-code-big">for i in range(5):
    if i == 2:
        continue  # 2만 건너뜀
    print(i)</pre>
        <div class="bc-result">
          <span class="result-label">출력:</span>
          <span class="result-values">0 1 3 4</span>
        </div>
        <div class="bc-analogy">⏭️ "이번만 패스!"</div>
      </div>
    </div>
  </div>
`

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

// Step 5: 퀴즈
const renderStep5Quiz = () => `
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
    
    // 변수 할당
    const assignMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/)
    if (assignMatch) {
      stepNum++
      const vName = assignMatch[1]
      let vValue = assignMatch[2]
      
      try {
        variables[vName] = eval(vValue)
      } catch {
        variables[vName] = vValue
      }
      
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
              <button class="btn primary small" id="btn-step-start">👣 실행하기</button>
            </div>
          </div>
          
          <div class="code-editor-box">
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
          </div>
          
          ${!isStepMode ? `
            <textarea id="code-input" class="code-textarea" spellcheck="false" placeholder="여기에 for 반복문 코드를 입력하세요...">${pythonCode || starterCode}</textarea>
          ` : ''}
          
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
          
          <!-- 출력 결과 -->
          <div class="output-section">
            <h4>💬 출력 결과</h4>
            <div class="output-display">
              ${currentOutputs.length > 0 
                ? currentOutputs.map(o => `<div class="output-line">${o}</div>`).join('') 
                : '<span class="muted">아직 출력이 없어요</span>'}
            </div>
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
// ✏️ 문제 페이지 (Practice)
// ============================================

const renderPracticePage = () => {
  return `
    <div class="page-content practice-page">
      <div class="page-header">
        <div class="header-icon">✏️</div>
        <h1>반복문 연습 문제</h1>
        <p class="header-desc">반복문을 활용해서 문제를 풀어보세요!</p>
      </div>

      <div class="practice-grid">
        <!-- 쉬움 문제 -->
        <div class="practice-card level-easy">
          <div class="practice-level">🌱 쉬움</div>
          <div class="practice-emoji">🔢</div>
          <h3>1부터 10까지 출력</h3>
          <p>for문을 사용해서 1부터 10까지 숫자를 출력해보세요.</p>
          <div class="practice-hint">
            <strong>힌트:</strong> range(1, 11) 사용
          </div>
          <button class="btn accent practice-btn" data-code="# 1부터 10까지 출력하기\\nfor i in range(1, 11):\\n    print(i)">🔍 정답 보기</button>
        </div>

        <div class="practice-card level-easy">
          <div class="practice-level">🌱 쉬움</div>
          <div class="practice-emoji">✖️</div>
          <h3>구구단 출력</h3>
          <p>원하는 단의 구구단을 출력해보세요.</p>
          <div class="practice-hint">
            <strong>힌트:</strong> f-string으로 출력 형식 만들기
          </div>
          <button class="btn accent practice-btn" data-code="# 구구단 5단 출력\\nfor i in range(1, 10):\\n    print(f'5 x {i} = {5*i}')">🔍 정답 보기</button>
        </div>

        <div class="practice-card level-easy">
          <div class="practice-level">🌱 쉬움</div>
          <div class="practice-emoji">⭐</div>
          <h3>별 찍기</h3>
          <p>*을 5개 한 줄에 출력해보세요.</p>
          <div class="practice-hint">
            <strong>힌트:</strong> print("*", end="") 사용
          </div>
          <button class="btn accent practice-btn" data-code="# 별 5개 출력\\nfor i in range(5):\\n    print('*', end='')">🔍 정답 보기</button>
        </div>

        <!-- 보통 문제 -->
        <div class="practice-card level-medium">
          <div class="practice-level">🌿 보통</div>
          <div class="practice-emoji">➕</div>
          <h3>1부터 100까지 합</h3>
          <p>1부터 100까지의 합을 구해보세요.</p>
          <div class="practice-hint">
            <strong>힌트:</strong> 합계를 저장할 변수 필요
          </div>
          <button class="btn accent practice-btn" data-code="# 1부터 100까지 합\\ntotal = 0\\nfor i in range(1, 101):\\n    total = total + i\\nprint(f'합계: {total}')">🔍 정답 보기</button>
        </div>

        <div class="practice-card level-medium">
          <div class="practice-level">🌿 보통</div>
          <div class="practice-emoji">🔄</div>
          <h3>짝수만 출력</h3>
          <p>1부터 20까지 중 짝수만 출력해보세요.</p>
          <div class="practice-hint">
            <strong>힌트:</strong> if i % 2 == 0 사용
          </div>
          <button class="btn accent practice-btn" data-code="# 짝수만 출력\\nfor i in range(1, 21):\\n    if i % 2 == 0:\\n        print(i)">🔍 정답 보기</button>
        </div>

        <div class="practice-card level-medium">
          <div class="practice-level">🌿 보통</div>
          <div class="practice-emoji">🔙</div>
          <h3>역순 출력</h3>
          <p>10부터 1까지 거꾸로 출력해보세요.</p>
          <div class="practice-hint">
            <strong>힌트:</strong> range(10, 0, -1) 사용
          </div>
          <button class="btn accent practice-btn" data-code="# 10부터 1까지 역순\\nfor i in range(10, 0, -1):\\n    print(i)">🔍 정답 보기</button>
        </div>
      </div>
    </div>
  `
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

// 프로젝트 실행 흐름 섹션 렌더링
const renderProjectTraceSection = () => {
  if (projectTrace.length === 0) return ''
  
  const currentStep = projectTrace[projectTraceIndex]
  const codeLines = projectCode.split('\n')
  
  // 코드 라인 렌더링
  const codeHTML = codeLines.map((line, idx) => {
    const lineNum = idx + 1
    const isActive = currentStep && currentStep.line === lineNum
    const isExecuted = projectTrace.slice(0, projectTraceIndex + 1).some(t => t.line === lineNum)
    let className = 'trace-code-line'
    if (isActive) className += ' active'
    else if (isExecuted) className += ' executed'
    return '<div class="' + className + '"><span class="line-num">' + lineNum + '</span><span class="line-code">' + highlightPython(line || ' ') + '</span></div>'
  }).join('')
  
  // 트레이스 테이블 렌더링
  const traceRows = projectTrace.slice(0, projectTraceIndex + 1).map((step, idx) => {
    const isActive = idx === projectTraceIndex
    const varsHTML = Object.entries(step.vars || {}).map(([k, v]) => '<span class="var-chip">' + k + '=' + v + '</span>').join(' ')
    const outputHTML = step.output ? '<span class="output-text">' + step.output + '</span>' : '<span class="no-output">-</span>'
    return '<tr class="' + (isActive ? 'active' : '') + '"><td>' + (idx + 1) + '</td><td>' + step.line + '</td><td>' + varsHTML + '</td><td>' + outputHTML + '</td></tr>'
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
            <button class="btn ghost" id="reset-code">🔄 초기화</button>
          </div>
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
    if (!executed.includes(trace[i].line)) {
      executed.push(trace[i].line)
    }
  }
  return executed
}

const renderMiniVars = (trace, currentIndex) => {
  if (currentIndex < 0 || !trace.length) {
    return '<span class="mini-vars-empty">아직 변수가 없어요</span>'
  }
  
  const current = trace[currentIndex]
  if (!current || !current.locals || Object.keys(current.locals).length === 0) {
    return '<span class="mini-vars-empty">아직 변수가 없어요</span>'
  }
  
  return Object.entries(current.locals)
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

  // 현재 trace 정보
  const currentTrace = miniStepMode ? fakeInterpreter(miniEditorCode).trace : []
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
      
      ${outputLines.length > 0 ? '<div class="helper-output"><div class="helper-section-title">💬 출력</div><pre class="helper-output-text">' + outputLines.join('\n') + '</pre></div>' : ''}
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
    <div class="app-container">
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
    </div>
  `

  attachEvents()
  updateApiKeyStatusUI()
}

const attachIntroEvents = () => {
  const startBtn = document.querySelector('#start-btn')
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      currentPage = 'concept'
      renderApp()
    })
  }
}

// 미니 에디터 UI만 업데이트
const updateMiniEditorUI = () => {
  const editor = document.querySelector('#mini-editor')
  if (!editor) return
  
  if (miniStepMode) {
    const codePreview = editor.querySelector('.mini-code-preview')
    const varsInline = editor.querySelector('.mini-vars-inline')
    const stepProgress = editor.querySelector('.step-progress')
    const nextBtn = editor.querySelector('#mini-step-next')
    
    const executedLines = getExecutedLines(miniStepTrace, miniStepIndex)
    const isFinished = miniStepIndex >= miniStepTrace.length - 1
    
    if (codePreview) {
      codePreview.innerHTML = renderMiniCodePreview(miniEditorCode, miniStepTrace[miniStepIndex]?.line, executedLines)
    }
    
    if (varsInline) {
      varsInline.innerHTML = `📦 ${renderMiniVars(miniStepTrace, miniStepIndex)}`
    }
    
    if (stepProgress) {
      stepProgress.textContent = `${miniStepIndex + 1} / ${miniStepTrace.length}`
    }
    
    if (nextBtn) {
      nextBtn.disabled = isFinished
      nextBtn.innerHTML = isFinished ? '✅ 완료!' : '다음 줄 ▶️'
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
    miniStepNext.addEventListener('click', () => {
      const trace = fakeInterpreter(miniEditorCode).trace
      if (miniStepIndex < trace.length - 1) {
        miniStepIndex++
        renderApp()
      }
    })
  }
  
  // 스텝 모드 컨트롤 - 이전
  const miniStepPrev = document.querySelector('#mini-step-prev')
  if (miniStepPrev) {
    miniStepPrev.addEventListener('click', () => {
      if (miniStepIndex > 0) {
        miniStepIndex--
        renderApp()
      }
    })
  }

  // 스텝 모드 컨트롤 - 처음으로
  const miniStepReset = document.querySelector('#mini-step-reset')
  if (miniStepReset) {
    miniStepReset.addEventListener('click', () => {
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

  initMiniEditorDrag()

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
      })
    })
  }

  // 문제 페이지 이벤트
  if (currentPage === 'practice') {
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
        renderApp()
      })
    }
    if (tracePrevBtn) {
      tracePrevBtn.addEventListener('click', (e) => {
        e.preventDefault()
        if (projectTraceIndex > 0) {
          projectTraceIndex--
          renderApp()
        }
      })
    }
    if (traceNextBtn) {
      traceNextBtn.addEventListener('click', (e) => {
        e.preventDefault()
        if (projectTraceIndex < projectTrace.length - 1) {
          projectTraceIndex++
          renderApp()
        }
      })
    }
    if (traceLastBtn) {
      traceLastBtn.addEventListener('click', (e) => {
        e.preventDefault()
        projectTraceIndex = projectTrace.length - 1
        renderApp()
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
  }

  // 실행 흐름 페이지 (Fake Interpreter 방식)
  if (currentPage === 'trace') {
    const resetBtn = document.querySelector('#btn-reset')
    const stepStartBtn = document.querySelector('#btn-step-start')
    const input = document.querySelector('#code-input')

    // 예제 불러오기
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        pythonCode = `# 🔄 for 반복문 예제
for i in range(5):
    print(i)`
        pythonStepMode = false
        pythonStepIndex = -1
        latestTrace = []
        renderApp()
      })
    }

    // 실행하기 (Fake Interpreter 사용)
    if (stepStartBtn) {
      stepStartBtn.addEventListener('click', () => {
        const code = input?.value || pythonCode || starterCode
        pythonCode = code
        
        // Fake Interpreter로 실행 단계 생성
        const result = fakeInterpreter(code)
        
        if (result.trace.length > 0) {
          latestTrace = result.trace
          pythonStepMode = true
          pythonStepIndex = 0
          renderApp()
        } else {
          alert('⚠️ 실행할 for 반복문이 없어요!\n\nfor i in range(5):\n    print(i)\n\n형태로 입력해주세요.')
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
        row.classList.remove('active')
        if (lineNum === currentStep.lineNum) {
          row.classList.add('active')
        }
      })
      
// 3. 출력 업데이트 (end 파라미터 고려해서 한 줄로 합침)
      const outputDisplay = document.querySelector('.output-display')
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
        }
      }
      
      // 4. 단계 정보 업데이트
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
      
      // 5. 버튼 상태 업데이트
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
        const scrollY = window.scrollY // 현재 스크롤 위치 저장
        pythonStepIndex = 0
        renderApp()
        window.scrollTo(0, scrollY) // 스크롤 위치 복원
      })
    }

    if (stepPrevBtn) {
      stepPrevBtn.addEventListener('click', (e) => {
        e.preventDefault()
        if (pythonStepIndex > 0) {
          const scrollY = window.scrollY // 현재 스크롤 위치 저장
          pythonStepIndex--
          renderApp()
          window.scrollTo(0, scrollY) // 스크롤 위치 복원
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
}

// 앱 시작
renderApp()
checkApiKey() // API 키 확인
