import './style.css'

// ============================================
// 🎯 앱 상태 관리
// ============================================
let currentPage = 'concept' // concept, python, project
let miniEditorOpen = false
let miniEditorMinimized = false
let miniEditorCode = `# 🎮 여기에 코드를 입력해보세요!
print("안녕하세요!")

for i in range(3):
    print(f"{i+1}번째 인사!")`

// 미니 에디터 스텝 모드 상태
let miniStepMode = false
let miniStepTrace = []
let miniStepIndex = -1
let miniStepOutput = []
let miniStepError = ''

// ============================================
// 🐍 파이썬 관련 코드 (기존 코드 유지)
// ============================================
const starterCode = `# 🌟 for 문과 while 문을 비교해보는 예제예요!
total = 0
for i in range(1, 5):
    total += i

count = 3
while count > 0:
    total += count
    count -= 1

print("합계:", total)`

let pyodideReady = null
let playbackTimer = null
let playbackIndex = 0
let latestTrace = []

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
output_lines = []

class OutputCapture:
    def write(self, text):
        if text.strip():
            output_lines.append(text)
    def flush(self):
        pass

old_stdout = sys.stdout
sys.stdout = OutputCapture()

def tracer(frame, event, arg):
    if event == 'line':
        ln = frame.f_lineno
        # 내부 변수 제외 (self, text, arg 등)
        skip_vars = {'self', 'text', 'arg', 'frame', 'event', 'tracer', 'ns', 'code', 'lines', 'trace_log', 'output_lines', 'old_stdout', 'status', 'error', 'OutputCapture'}
        local_vars = {k: repr(v) for k, v in frame.f_locals.items() if not k.startswith('__') and k not in skip_vars}
        src = lines[ln-1] if 0 <= ln-1 < len(lines) else ''
        trace_log.append({"line": ln, "locals": local_vars, "source": src})
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

json.dumps({"status": status, "error": error, "trace": trace_log, "output": output_lines})
`
  const resultText = await pyodide.runPythonAsync(program)
  return JSON.parse(resultText)
}

// ============================================
// 🎨 페이지 렌더링 함수들
// ============================================

const renderNavigation = () => {
  return `
    <nav class="cute-nav">
      <div class="nav-logo">
        <span class="logo-icon">🌈</span>
        <span class="logo-text">코딩 놀이터</span>
      </div>
      <div class="nav-tabs">
        <button class="nav-tab ${currentPage === 'concept' ? 'active' : ''}" data-page="concept">
          <span class="tab-icon">📚</span>
          <span class="tab-text">개념</span>
        </button>
        <button class="nav-tab ${currentPage === 'python' ? 'active' : ''}" data-page="python">
          <span class="tab-icon">🐍</span>
          <span class="tab-text">파이썬 코드 도우미</span>
        </button>
        <button class="nav-tab ${currentPage === 'project' ? 'active' : ''}" data-page="project">
          <span class="tab-icon">🎨</span>
          <span class="tab-text">프로젝트</span>
        </button>
      </div>
    </nav>
  `
}

const renderConceptPage = () => {
  return `
    <div class="page-content concept-page">
      <div class="page-header">
        <div class="header-icon">📚</div>
        <h1>프로그래밍 개념 배우기</h1>
        <p class="header-desc">재미있는 프로그래밍 세계로 떠나볼까요? 🚀</p>
      </div>

      <div class="concept-grid">
        <div class="concept-card" data-code="for i in range(5):\n    print('안녕!')">
          <div class="card-emoji">🔄</div>
          <h3>반복문 (Loop)</h3>
          <p>같은 일을 여러 번 반복할 때 사용해요!</p>
          <div class="card-example">
            <code>for i in range(5):</code>
            <code>    print("안녕!")</code>
          </div>
          <div class="card-tip">
            💡 5번 "안녕!"이 출력돼요!
          </div>
          <button class="btn mini try-code-btn">🐍 코드 실행해보기</button>
        </div>

        <div class="concept-card" data-code="score = 95\nif score >= 90:\n    print('대단해요!')\nelse:\n    print('다음엔 더 잘할 수 있어요!')">
          <div class="card-emoji">🤔</div>
          <h3>조건문 (If)</h3>
          <p>상황에 따라 다르게 행동할 때 써요!</p>
          <div class="card-example">
            <code>if 점수 >= 90:</code>
            <code>    print("대단해요!")</code>
          </div>
          <div class="card-tip">
            💡 점수가 90점 이상이면 칭찬해요!
          </div>
          <button class="btn mini try-code-btn">🐍 코드 실행해보기</button>
        </div>

        <div class="concept-card" data-code="name = '토끼'\nage = 5\nprint(f'이름: {name}')\nprint(f'나이: {age}살')">
          <div class="card-emoji">📦</div>
          <h3>변수 (Variable)</h3>
          <p>정보를 담아두는 상자예요!</p>
          <div class="card-example">
            <code>이름 = "토끼"</code>
            <code>나이 = 5</code>
          </div>
          <div class="card-tip">
            💡 상자에 이름표를 붙여두는 것처럼요!
          </div>
          <button class="btn mini try-code-btn">🐍 코드 실행해보기</button>
        </div>

        <div class="concept-card" data-code="def say_hello(name):\n    print(f'안녕, {name}!')\n\nsay_hello('토끼')\nsay_hello('고양이')">
          <div class="card-emoji">🎯</div>
          <h3>함수 (Function)</h3>
          <p>자주 쓰는 코드를 묶어둔 거예요!</p>
          <div class="card-example">
            <code>def 인사하기():</code>
            <code>    print("안녕!")</code>
          </div>
          <div class="card-tip">
            💡 버튼 하나로 여러 일을 할 수 있어요!
          </div>
          <button class="btn mini try-code-btn">🐍 코드 실행해보기</button>
        </div>

        <div class="concept-card" data-code="fruits = ['사과', '바나나', '딸기']\nprint('과일 목록:')\nfor fruit in fruits:\n    print(f'  - {fruit}')">
          <div class="card-emoji">📋</div>
          <h3>리스트 (List)</h3>
          <p>여러 개를 한 줄로 모아둔 거예요!</p>
          <div class="card-example">
            <code>과일들 = ["사과", "바나나", "딸기"]</code>
          </div>
          <div class="card-tip">
            💡 줄 서있는 것처럼 순서가 있어요!
          </div>
          <button class="btn mini try-code-btn">🐍 코드 실행해보기</button>
        </div>

        <div class="concept-card" data-code="number = 42\ntext = '안녕'\nis_happy = True\n\nprint(f'숫자: {number} (타입: {type(number).__name__})')\nprint(f'문자: {text} (타입: {type(text).__name__})')\nprint(f'참거짓: {is_happy} (타입: {type(is_happy).__name__})')">
          <div class="card-emoji">🔢</div>
          <h3>자료형 (Data Type)</h3>
          <p>숫자, 글자, 참/거짓 등 종류가 있어요!</p>
          <div class="card-example">
            <code>숫자 = 42</code>
            <code>글자 = "안녕"</code>
          </div>
          <div class="card-tip">
            💡 각각 다르게 다뤄야 해요!
          </div>
          <button class="btn mini try-code-btn">🐍 코드 실행해보기</button>
        </div>
      </div>

      <div class="fun-fact-box">
        <div class="fun-fact-icon">🎉</div>
        <div class="fun-fact-content">
          <h4>재미있는 사실!</h4>
          <p>파이썬이라는 이름은 뱀이 아니라 영국의 코미디 그룹 "몬티 파이썬"에서 따온 거예요! 🎭</p>
        </div>
      </div>
    </div>
  `
}

const renderPythonPage = () => {
  return `
    <div class="page-content python-page">
      <div class="page-header">
        <div class="header-icon">🐍</div>
        <h1>파이썬 코드 도우미</h1>
        <p class="header-desc">코드를 실행하고 어떻게 동작하는지 확인해봐요! ✨</p>
      </div>

      <section id="workspace" class="section workspace">
        <div class="editor-card">
          <div class="card-head">
            <div>
              <p class="eyebrow">✏️ 코드 입력</p>
              <h3>내 코드를 붙여넣거나 수정해 보세요</h3>
            </div>
            <div class="btn-row">
              <button class="btn ghost" id="btn-reset">📋 예제 불러오기</button>
              <button class="btn primary" id="btn-run">▶️ 실행하기</button>
            </div>
          </div>
          <textarea id="code-input" spellcheck="false">${starterCode}</textarea>
          <p class="muted">🔒 실행은 브라우저에서 안전하게 처리돼요!</p>
        </div>
        <div class="status-card">
          <p class="eyebrow">💬 피드백</p>
          <h3 id="status-title">아직 실행 전이에요</h3>
          <p id="status-detail" class="muted">코드를 실행하면 결과와 함께 안내가 표시됩니다.</p>
          <p id="playback-state" class="muted">▶️ 실행 흐름 대기 중</p>
        </div>
      </section>

      <section class="section panels">
        <div class="panel">
          <div class="panel-head">
            <h4>🔍 라인별 하이라이트</h4>
          </div>
          <div id="code-preview" class="code-preview"></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h4>📦 변수 변화</h4>
          </div>
          <div id="var-box" class="var-box"></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h4>📝 실행 추적</h4>
          </div>
          <div id="trace-list" class="trace-list"></div>
        </div>
      </section>

      <section id="flow-area" class="section">
        <div class="section__heading">
          <p>🗺️ 순서도</p>
          <h2>조건은 마름모, 순차는 직사각형, 입출력은 평행사변형</h2>
        </div>
        <div id="flowchart" class="flowchart"></div>
      </section>
    </div>
  `
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
guesses = [3, 7, 5]  # 미리 정한 추측들

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

def complete_todo(index):
    if 0 <= index < len(todos):
        todos[index]["done"] = True
        print(f"🎉 '{todos[index]['task']}' 완료!")

def show_todos():
    print("\\n📋 할 일 목록:")
    for i, todo in enumerate(todos):
        status = "✅" if todo["done"] else "⬜"
        print(f"  {i+1}. {status} {todo['task']}")

# 사용해보기
add_todo("파이썬 공부하기")
add_todo("숙제하기")
add_todo("운동하기")
show_todos()

complete_todo(0)
show_todos()`,

  turtle: `# 🐢 거북이 그림 그리기 (시뮬레이션)
# 실제 turtle 모듈은 브라우저에서 동작하지 않아서
# 명령어를 시뮬레이션해요!

commands = []

def forward(distance):
    commands.append(f"→ {distance}픽셀 전진")

def right(angle):
    commands.append(f"↻ {angle}도 오른쪽 회전")

def left(angle):
    commands.append(f"↺ {angle}도 왼쪽 회전")

# 정사각형 그리기
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

# 게임 3판!
print("🎮 가위바위보 게임!\\n")
for i, choice in enumerate(["가위", "바위", "보"], 1):
    print(f"--- {i}판 ---")
    result = play(choice)
    print(f"결과: {result}\\n")`
}

const renderProjectPage = () => {
  return `
    <div class="page-content project-page">
      <div class="page-header">
        <div class="header-icon">🎨</div>
        <h1>나만의 프로젝트</h1>
        <p class="header-desc">배운 것을 활용해서 멋진 프로젝트를 만들어봐요! 🌟</p>
      </div>

      <div class="project-intro">
        <div class="intro-card">
          <span class="intro-emoji">💡</span>
          <h3>프로젝트란?</h3>
          <p>배운 프로그래밍 개념들을 모아서 실제로 동작하는 프로그램을 만드는 거예요!</p>
        </div>
      </div>

      <h2 class="section-title">🎯 추천 프로젝트</h2>
      
      <div class="project-grid">
        <div class="project-card level-easy">
          <div class="project-level">🌱 쉬움</div>
          <div class="project-emoji">🎲</div>
          <h3>주사위 게임</h3>
          <p>랜덤한 숫자를 만들어서 주사위를 굴려봐요!</p>
          <div class="project-skills">
            <span class="skill-tag">랜덤</span>
            <span class="skill-tag">조건문</span>
          </div>
          <button class="btn ghost try-btn" data-project="dice">🐍 도전하기 →</button>
        </div>

        <div class="project-card level-easy">
          <div class="project-level">🌱 쉬움</div>
          <div class="project-emoji">🧮</div>
          <h3>간단 계산기</h3>
          <p>더하기, 빼기, 곱하기, 나누기를 할 수 있는 계산기예요!</p>
          <div class="project-skills">
            <span class="skill-tag">함수</span>
            <span class="skill-tag">연산</span>
          </div>
          <button class="btn ghost try-btn" data-project="calc">🐍 도전하기 →</button>
        </div>

        <div class="project-card level-medium">
          <div class="project-level">🌿 보통</div>
          <div class="project-emoji">🔮</div>
          <h3>숫자 맞추기 게임</h3>
          <p>컴퓨터가 생각한 숫자를 맞춰보세요!</p>
          <div class="project-skills">
            <span class="skill-tag">반복문</span>
            <span class="skill-tag">조건문</span>
            <span class="skill-tag">랜덤</span>
          </div>
          <button class="btn ghost try-btn" data-project="guess">🐍 도전하기 →</button>
        </div>

        <div class="project-card level-medium">
          <div class="project-level">🌿 보통</div>
          <div class="project-emoji">📝</div>
          <h3>할 일 목록</h3>
          <p>해야 할 일을 추가하고 완료 표시를 해봐요!</p>
          <div class="project-skills">
            <span class="skill-tag">리스트</span>
            <span class="skill-tag">함수</span>
          </div>
          <button class="btn ghost try-btn" data-project="todo">🐍 도전하기 →</button>
        </div>

        <div class="project-card level-hard">
          <div class="project-level">🌳 어려움</div>
          <div class="project-emoji">🐢</div>
          <h3>거북이 그림 그리기</h3>
          <p>거북이를 움직여서 멋진 그림을 그려봐요!</p>
          <div class="project-skills">
            <span class="skill-tag">반복문</span>
            <span class="skill-tag">함수</span>
            <span class="skill-tag">turtle</span>
          </div>
          <button class="btn ghost try-btn" data-project="turtle">🐍 도전하기 →</button>
        </div>

        <div class="project-card level-hard">
          <div class="project-level">🌳 어려움</div>
          <div class="project-emoji">🎮</div>
          <h3>가위바위보 AI</h3>
          <p>컴퓨터와 가위바위보 대결을 해봐요!</p>
          <div class="project-skills">
            <span class="skill-tag">조건문</span>
            <span class="skill-tag">랜덤</span>
            <span class="skill-tag">반복문</span>
          </div>
          <button class="btn ghost try-btn" data-project="rps">🐍 도전하기 →</button>
        </div>
      </div>

      <div class="achievement-box">
        <div class="achievement-header">
          <span class="achievement-icon">🏆</span>
          <h3>나의 성취</h3>
        </div>
        <div class="achievement-content">
          <div class="achievement-item">
            <span class="badge locked">🔒</span>
            <span>첫 프로젝트 완료</span>
          </div>
          <div class="achievement-item">
            <span class="badge locked">🔒</span>
            <span>반복문 마스터</span>
          </div>
          <div class="achievement-item">
            <span class="badge locked">🔒</span>
            <span>조건문 마스터</span>
          </div>
          <div class="achievement-item">
            <span class="badge locked">🔒</span>
            <span>모든 프로젝트 완료</span>
          </div>
        </div>
      </div>
    </div>
  `
}

// ============================================
// 🐍 미니 에디터 (플로팅) - 스텝 모드 포함
// ============================================

// 미니 에디터 코드 미리보기 렌더링
const renderMiniCodePreview = (code, activeLine) => {
  const lines = code.split('\n')
  return lines
    .map((line, idx) => {
      const lineNumber = idx + 1
      const isActive = activeLine === lineNumber
      return `<div class="mini-code-line ${isActive ? 'active' : ''}">
        <span class="mini-code-lno">${lineNumber}</span>
        <span class="mini-code-text">${line || '&nbsp;'}</span>
      </div>`
    })
    .join('')
}

// 미니 에디터 변수 상태 렌더링
const renderMiniVars = (trace, currentIndex) => {
  if (currentIndex < 0 || !trace.length) {
    return '<p class="muted">📦 변수가 여기에 표시됩니다</p>'
  }
  
  const current = trace[currentIndex]
  if (!current || !current.locals || Object.keys(current.locals).length === 0) {
    return '<p class="muted">아직 변수가 없어요</p>'
  }
  
  return Object.entries(current.locals)
    .map(([k, v]) => `
      <div class="mini-var-item">
        <span class="mini-var-name">🏷️ ${k}</span>
        <span class="mini-var-value">${v}</span>
      </div>
    `)
    .join('')
}

const renderMiniEditor = () => {
  if (currentPage === 'python') return '' // 파이썬 페이지에서는 미니 에디터 숨김
  
  if (!miniEditorOpen) {
    return `
      <button class="mini-editor-fab" id="open-mini-editor">
        <span>🐍</span>
        <span class="fab-text">코드 실행</span>
      </button>
    `
  }

  // 스텝 모드 UI
  const stepModeUI = miniStepMode ? `
    <div class="mini-step-container">
      <div class="mini-step-header">
        <div class="mini-step-info">
          <span class="step-badge">📍 스텝 ${miniStepIndex + 1} / ${miniStepTrace.length}</span>
          ${miniStepIndex >= 0 && miniStepTrace[miniStepIndex] ? 
            `<span class="step-line">Line ${miniStepTrace[miniStepIndex].line}</span>` : ''}
        </div>
        <button class="btn mini ghost" id="mini-step-reset">🔄 처음으로</button>
      </div>
      
      <div class="mini-code-preview">
        ${renderMiniCodePreview(miniEditorCode, miniStepTrace[miniStepIndex]?.line)}
      </div>
      
      <div class="mini-step-controls">
        <button class="btn mini primary" id="mini-step-next" ${miniStepIndex >= miniStepTrace.length - 1 ? 'disabled' : ''}>
          ⏭️ 다음 단계
        </button>
        <button class="btn mini ghost" id="mini-step-exit">✕ 스텝 모드 종료</button>
      </div>
      
      <div class="mini-vars-panel">
        <div class="mini-vars-header">📦 현재 변수 상태</div>
        <div class="mini-vars-content">
          ${renderMiniVars(miniStepTrace, miniStepIndex)}
        </div>
      </div>
      
      ${miniStepTrace[miniStepIndex]?.source ? `
        <div class="mini-current-line">
          <span class="current-line-label">🎯 실행 중인 코드:</span>
          <code class="current-line-code">${miniStepTrace[miniStepIndex].source}</code>
        </div>
      ` : ''}
    </div>
  ` : ''

  // 일반 모드 UI
  const normalModeUI = !miniStepMode ? `
    <div class="mini-editor-body">
      <textarea id="mini-code-input" spellcheck="false" placeholder="여기에 코드를 입력하세요...">${miniEditorCode}</textarea>
      <div class="mini-editor-actions">
        <button class="btn mini primary" id="mini-run">▶️ 실행</button>
        <button class="btn mini accent" id="mini-step-start">👣 한 단계씩</button>
        <button class="btn mini ghost" id="mini-clear">🗑️</button>
      </div>
      <div class="mini-output" id="mini-output">
        <p class="muted">💬 실행 결과가 여기에 표시됩니다</p>
      </div>
    </div>
  ` : ''

  return `
    <div class="mini-editor ${miniEditorMinimized ? 'minimized' : ''} ${miniStepMode ? 'step-mode' : ''}" id="mini-editor">
      <div class="mini-editor-header" id="mini-editor-header">
        <div class="mini-editor-title">
          <span>🐍</span>
          <span>${miniStepMode ? '스텝 실행 모드' : '파이썬 미니 에디터'}</span>
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
  
  let pageContent = ''
  switch (currentPage) {
    case 'concept':
      pageContent = renderConceptPage()
      break
    case 'python':
      pageContent = renderPythonPage()
      break
    case 'project':
      pageContent = renderProjectPage()
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
}

// 미니 에디터 UI만 업데이트 (전체 렌더링 없이)
const updateMiniEditorUI = () => {
  const editor = document.querySelector('#mini-editor')
  if (!editor) return
  
  // 스텝 모드일 때만 부분 업데이트
  if (miniStepMode) {
    const codePreview = editor.querySelector('.mini-code-preview')
    const varsContent = editor.querySelector('.mini-vars-content')
    const stepInfo = editor.querySelector('.mini-step-info')
    const currentLine = editor.querySelector('.mini-current-line')
    const nextBtn = editor.querySelector('#mini-step-next')
    
    if (codePreview) {
      codePreview.innerHTML = renderMiniCodePreview(miniEditorCode, miniStepTrace[miniStepIndex]?.line)
    }
    
    if (varsContent) {
      varsContent.innerHTML = renderMiniVars(miniStepTrace, miniStepIndex)
    }
    
    if (stepInfo) {
      stepInfo.innerHTML = `
        <span class="step-badge">📍 스텝 ${miniStepIndex + 1} / ${miniStepTrace.length}</span>
        ${miniStepIndex >= 0 && miniStepTrace[miniStepIndex] ? 
          `<span class="step-line">Line ${miniStepTrace[miniStepIndex].line}</span>` : ''}
      `
    }
    
    if (currentLine && miniStepTrace[miniStepIndex]?.source) {
      currentLine.innerHTML = `
        <span class="current-line-label">🎯 실행 중인 코드:</span>
        <code class="current-line-code">${miniStepTrace[miniStepIndex].source}</code>
      `
    }
    
    if (nextBtn) {
      nextBtn.disabled = miniStepIndex >= miniStepTrace.length - 1
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
  // 네비게이션 탭 이벤트
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

  // 미니 에디터 열기 버튼
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

  // 미니 에디터 스텝 모드 시작
  const miniStepStart = document.querySelector('#mini-step-start')
  if (miniStepStart) {
    miniStepStart.addEventListener('click', async () => {
      const code = document.querySelector('#mini-code-input').value
      miniEditorCode = code
      
      const output = document.querySelector('#mini-output')
      output.innerHTML = '<p class="loading">⏳ 코드 분석 중...</p>'
      
      try {
        const result = await runPython(code)
        if (result.status === 'ok' && result.trace?.length > 0) {
          miniStepTrace = result.trace
          miniStepOutput = result.output || []
          miniStepIndex = 0
          miniStepMode = true
          renderApp()
        } else if (result.status === 'error') {
          output.innerHTML = `
            <div class="output-error">
              <p class="output-header">❌ 오류가 있어요</p>
              <p class="error-friendly">${friendlyExplain(result.error)}</p>
              <pre class="error-detail">${result.error}</pre>
            </div>
          `
        } else {
          output.innerHTML = `
            <div class="output-error">
              <p class="output-header">⚠️ 실행할 코드가 없어요</p>
              <p>코드를 입력하고 다시 시도해주세요!</p>
            </div>
          `
        }
      } catch (err) {
        output.innerHTML = `
          <div class="output-error">
            <p class="output-header">😓 분석 실패</p>
            <p>네트워크나 Pyodide 로드 상태를 확인해 주세요.</p>
          </div>
        `
      }
    })
  }

  // 스텝 모드 - 다음 단계
  const miniStepNext = document.querySelector('#mini-step-next')
  if (miniStepNext) {
    miniStepNext.addEventListener('click', () => {
      if (miniStepIndex < miniStepTrace.length - 1) {
        miniStepIndex++
        updateMiniEditorUI()
      }
    })
  }

  // 스텝 모드 - 처음으로
  const miniStepReset = document.querySelector('#mini-step-reset')
  if (miniStepReset) {
    miniStepReset.addEventListener('click', () => {
      miniStepIndex = 0
      updateMiniEditorUI()
    })
  }

  // 스텝 모드 - 종료
  const miniStepExit = document.querySelector('#mini-step-exit')
  if (miniStepExit) {
    miniStepExit.addEventListener('click', () => {
      miniStepMode = false
      miniStepTrace = []
      miniStepIndex = -1
      renderApp()
    })
  }

  // 미니 에디터 지우기
  const miniClear = document.querySelector('#mini-clear')
  if (miniClear) {
    miniClear.addEventListener('click', () => {
      const input = document.querySelector('#mini-code-input')
      const output = document.querySelector('#mini-output')
      if (input) {
        input.value = ''
        miniEditorCode = ''
      }
      if (output) {
        output.innerHTML = '<p class="muted">💬 실행 결과가 여기에 표시됩니다</p>'
      }
    })
  }

  // 미니 에디터 드래그 초기화
  initMiniEditorDrag()

  // 개념 페이지 - 코드 실행해보기 버튼
  if (currentPage === 'concept') {
    const tryCodeBtns = document.querySelectorAll('.try-code-btn')
    tryCodeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.concept-card')
        const code = card.dataset.code
        if (code) {
          miniEditorCode = code.replace(/\\n/g, '\n')
          miniEditorOpen = true
          miniEditorMinimized = false
          miniStepMode = false
          renderApp()
        }
      })
    })
  }

  // 프로젝트 버튼 이벤트
  if (currentPage === 'project') {
    const tryBtns = document.querySelectorAll('.try-btn')
    tryBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const projectId = btn.dataset.project
        if (projectCodes[projectId]) {
          miniEditorCode = projectCodes[projectId]
          miniEditorOpen = true
          miniEditorMinimized = false
          miniStepMode = false
          renderApp()
        }
      })
    })
  }

  // 파이썬 페이지일 때만 이벤트 연결
  if (currentPage === 'python') {
    const runBtn = document.querySelector('#btn-run')
    const resetBtn = document.querySelector('#btn-reset')
    const input = document.querySelector('#code-input')

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        input.value = starterCode
        renderCodePreview(starterCode)
        renderTraceList([], -1)
        renderVars([], -1)
        renderFlow([])
        stopPlayback()
        document.querySelector('#status-title').textContent = '📋 예제 코드가 준비됐어요!'
        document.querySelector('#status-detail').textContent = '원하는 대로 수정하고 실행해 보세요.'
        document.querySelector('#playback-state').textContent = '▶️ 실행 흐름 대기 중'
      })
    }

    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        const code = input.value
        document.querySelector('#status-title').textContent = '⏳ 실행 중...'
        document.querySelector('#status-detail').textContent = '잠시만 기다려 주세요.'
        document.querySelector('#playback-state').textContent = '⏳ 실행 흐름 준비 중'
        stopPlayback()
        try {
          const result = await runPython(code)
          latestTrace = result.trace || []
          const friendly = friendlyExplain(result.error)
          renderCodePreview(code, latestTrace[0]?.line)
          renderTraceList(latestTrace, 0)
          renderVars(latestTrace, 0)
          renderFlow(latestTrace)
          if (result.status === 'ok') {
            document.querySelector('#status-title').textContent = '🎉 성공적으로 실행됐어요!'
            document.querySelector('#status-detail').textContent = '한 줄씩 어떻게 흘렀는지 살펴볼까요?'
            startPlayback(code)
          } else {
            document.querySelector('#status-title').textContent = '😅 오류가 발생했어요'
            document.querySelector('#status-detail').textContent = `${friendly} (${result.error})`
            document.querySelector('#playback-state').textContent = '❗ 오류로 실행을 중단했어요'
          }
        } catch (err) {
          document.querySelector('#status-title').textContent = '😓 실행에 문제가 있어요'
          document.querySelector('#status-detail').textContent =
            '네트워크나 Pyodide 로드 상태를 확인해 주세요.'
          document.querySelector('#playback-state').textContent = '❗ 실행 실패'
          console.error(err)
        }
      })
    }

    // 초기 렌더링
    renderCodePreview(starterCode)
    renderTraceList([], -1)
    renderVars([], -1)
    renderFlow([])
  }
}

// 앱 시작
renderApp()
