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

    loginBtn.textContent = 'Google 로그아웃'
    userInfoEl.textContent = `${displayName}${email ? ' (' + email + ')' : ''}`
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
// 주의: preventDefault()를 사용하지 않고 <a> 태그의 기본 동작을 사용
// 단, 로그인 상태만 확인하고 미로그인 시에만 기본 동작을 막음
if (studentLinkEl) {
  studentLinkEl.addEventListener('click', (e) => {
    // 로그인 상태 확인
    const currentUser = auth.currentUser
    console.log('학생으로 시작 버튼 클릭됨, 로그인 상태:', !!currentUser, 'isLoggedIn:', isLoggedIn)
    
    // 로그인되지 않은 경우에만 기본 동작(페이지 이동)을 막음
    if (!currentUser || !isLoggedIn) {
      e.preventDefault()
      alert('먼저 Google 로그인을 해주세요.')
      return false
    }
    
    // 로그인된 경우: <a> 태그의 기본 동작(href="/student.html")을 그대로 사용
    // preventDefault()를 호출하지 않으므로 브라우저가 자연스럽게 페이지 이동 처리
    console.log('페이지 이동 허용: /student.html')
  })
}

// 인증 상태 변화 감지
onAuthStateChanged(auth, (user) => {
  updateUIForUser(user)
})

// 초기 UI 상태
updateUIForUser(auth.currentUser)

