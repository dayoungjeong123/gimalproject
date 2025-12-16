import { auth, googleProvider } from './firebaseConfig'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'

const loginBtn = document.getElementById('google-login-btn')
const userInfoEl = document.getElementById('google-user-info')
const entryLinksEl = document.getElementById('entry-links')

const updateUIForUser = (user) => {
  if (!loginBtn || !userInfoEl || !entryLinksEl) return

  if (user) {
    // 로그인된 상태
    const displayName = user.displayName || '익명 사용자'
    const email = user.email || ''

    loginBtn.textContent = 'Google 로그아웃'
    userInfoEl.textContent = `${displayName}${email ? ' (' + email + ')' : ''}`
    userInfoEl.style.display = 'block'
    entryLinksEl.style.display = 'flex'
  } else {
    // 로그아웃 상태
    loginBtn.textContent = 'Google 로그인'
    userInfoEl.textContent = ''
    userInfoEl.style.display = 'none'
    entryLinksEl.style.display = 'none'
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

// 인증 상태 변화 감지
onAuthStateChanged(auth, (user) => {
  updateUIForUser(user)
})

// 초기 UI 상태
updateUIForUser(auth.currentUser)

