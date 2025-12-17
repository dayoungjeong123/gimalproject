import { auth, googleProvider } from './firebaseConfig'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'

const loginBtn = document.getElementById('google-login-btn')
const userInfoEl = document.getElementById('google-user-info')
const entryLinksEl = document.getElementById('entry-links')
const teacherLinkEl = document.getElementById('teacher-link')
const studentLinkEl = document.getElementById('student-link')

const ADMIN_UID = 'AMu571T4XmRh7CWxIliZA0x0lkP2'

let isLoggedIn = false

const updateUIForUser = (user) => {
  if (!loginBtn || !userInfoEl || !entryLinksEl) return

  isLoggedIn = !!user

  if (user) {
    // 로그인된 상태
    const displayName = user.displayName || '익명 사용자'
    const email = user.email || ''

    // 저장된 학생 정보 불러오기 (있을 경우)
    let studentLine = ''
    try {
      const saved = localStorage.getItem('gimal_student_info')
      if (saved) {
        const info = JSON.parse(saved)
        if (info && info.klass && info.number && info.name) {
          studentLine = `${info.klass} ${info.number}번 ${info.name}`
        }
      }
    } catch (e) {
      console.warn('저장된 학생 정보를 불러오는 데 실패했습니다:', e)
    }

    loginBtn.textContent = 'Google 로그아웃'
    const baseText = `${displayName}${email ? ' (' + email + ')' : ''}`
    userInfoEl.innerHTML = studentLine
      ? `${baseText}<br><span class="student-meta">${studentLine}</span>`
      : baseText
    userInfoEl.style.display = 'block'
    entryLinksEl.style.display = 'flex'
    if (teacherLinkEl) {
      teacherLinkEl.style.display = user.uid === ADMIN_UID ? 'inline-flex' : 'none'
    }
  } else {
    // 로그아웃 상태
    loginBtn.textContent = 'Google 로그인'
    userInfoEl.textContent = ''
    userInfoEl.style.display = 'none'
    entryLinksEl.style.display = 'none'
    if (teacherLinkEl) {
      teacherLinkEl.style.display = 'none'
    }
  }
}

if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    try {
      if (!auth.currentUser) {
        // 로그인 시도
        await signInWithPopup(auth, googleProvider)
      } else {
        // 로그아웃
        await signOut(auth)
      }
    } catch (err) {
      console.error('Google 로그인 오류:', err)
      alert('Google 로그인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.')
    }
  })
}

// 학생으로 시작하기 버튼 클릭 이벤트
// Netlify 환경에서 인증 상태 동기화를 고려한 안정적인 처리
if (studentLinkEl) {
  studentLinkEl.addEventListener('click', async (e) => {
    e.preventDefault()
    
    // 인증 상태를 여러 방법으로 확인 (Netlify 환경 대응)
    const currentUser = auth.currentUser
    console.log('학생으로 시작 버튼 클릭됨, 로그인 상태:', !!currentUser, 'isLoggedIn:', isLoggedIn)
    
    // 로그인되지 않은 경우
    if (!currentUser && !isLoggedIn) {
      alert('먼저 Google 로그인을 해주세요.')
      return false
    }
    
    // 로그인된 경우: 세션 스토리지에 플래그 저장하여 리다이렉트 루프 방지
    if (currentUser || isLoggedIn) {
      sessionStorage.setItem('auth_verified', 'true')
      sessionStorage.setItem('auth_uid', currentUser?.uid || 'verified')
      console.log('페이지 이동 허용: /student.html (인증 확인됨)')
      window.location.href = '/student.html'
    } else {
      // 인증 상태가 불확실한 경우 잠시 대기 후 재확인
      await new Promise(resolve => setTimeout(resolve, 200))
      const retryUser = auth.currentUser
      if (retryUser) {
        sessionStorage.setItem('auth_verified', 'true')
        sessionStorage.setItem('auth_uid', retryUser.uid)
        window.location.href = '/student.html'
      } else {
        alert('로그인 상태를 확인할 수 없습니다. 다시 로그인해주세요.')
      }
    }
  })
}

// 인증 상태 변화 감지
onAuthStateChanged(auth, (user) => {
  updateUIForUser(user)
})

// 초기 UI 상태
updateUIForUser(auth.currentUser)

