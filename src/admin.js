import { auth, db, storage } from './firebaseConfig'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, getDocs, query, orderBy, doc, deleteDoc } from 'firebase/firestore'
import { ref as storageRef, getDownloadURL, deleteObject } from 'firebase/storage'

const ADMIN_UID = 'AMu571T4XmRh7CWxIliZA0x0lkP2'

onAuthStateChanged(auth, (user) => {
  if (!user || user.uid !== ADMIN_UID) {
    window.location.href = './index.html'
  }
})

let submissions = []
let activeDateFilters = new Set()
let activeClassFilters = new Set()
let activeUserFilter = null
let selectedSubmissionId = null

const dateFilterListEl = document.getElementById('date-filter-list')
const classFilterListEl = document.getElementById('class-filter-list')
const userFilterListEl = document.getElementById('user-filter-list')
const submissionListEl = document.getElementById('submission-list')
const projectCodeViewEl = document.getElementById('project-code-view')
const reflectionViewEl = document.getElementById('reflection-view')
const drawingViewEl = document.getElementById('drawing-view')

const loadSubmissionsFromFirebase = async () => {
  try {
    const q = query(collection(db, 'reflections'), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    submissions = snap.docs.map((doc) => {
      const data = doc.data()
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
      const dateStr = createdAt.toISOString().slice(0, 10)
      const timeStr = createdAt.toTimeString().slice(0, 5)

      const userMessages = Array.isArray(data.chatMessages)
        ? data.chatMessages.filter((m) => m.role === 'user').map((m) => m.content)
        : []

      return {
        id: doc.id,
        date: dateStr,
        className: data.studentClass || '미지정',
        userName: data.studentName || '이름 없음',
        submittedAt: timeStr,
        projectCodePath: data.projectCodePath || null,
        reflectionText:
          userMessages.length > 0
            ? userMessages.join('\n\n')
            : '수업 성찰 내용이 아직 충분히 기록되지 않았습니다.',
        drawingUrl: null
      }
    })

    activeDateFilters = new Set()
    activeClassFilters = new Set()
    activeUserFilter = null
    selectedSubmissionId = null

    renderDateFilters()
    renderClassFilters()
    renderUserFilters()
    renderSubmissionList()
  } catch (err) {
    console.error('교사용 데이터 불러오기 오류:', err)
    submissionListEl.innerHTML =
      '<p class="teacher-empty-message">데이터를 불러오는 중 오류가 발생했습니다.</p>'
  }
}

const getUniqueDates = () =>
  Array.from(new Set(submissions.map((s) => s.date))).sort()

const getUniqueClasses = () =>
  Array.from(new Set(submissions.map((s) => s.className))).sort()

const getUsersForDatesAndClasses = () => {
  const filtered = submissions.filter((s) => {
    const dateOk = activeDateFilters.size === 0 || activeDateFilters.has(s.date)
    const classOk =
      activeClassFilters.size === 0 || activeClassFilters.has(s.className)
    return dateOk && classOk
  })
  const names = Array.from(new Set(filtered.map((s) => s.userName))).sort()
  return names
}

const getFilteredSubmissions = () =>
  submissions.filter((s) => {
    const dateOk = activeDateFilters.size === 0 || activeDateFilters.has(s.date)
    const classOk =
      activeClassFilters.size === 0 || activeClassFilters.has(s.className)
    const userOk = !activeUserFilter || s.userName === activeUserFilter
    return dateOk && classOk && userOk
  })

const renderDateFilters = () => {
  const dates = getUniqueDates()
  dateFilterListEl.innerHTML = dates
    .map(
      (d) => `
      <label class="teacher-filter-item">
        <input type="checkbox" value="${d}" ${
          activeDateFilters.has(d) ? 'checked' : ''
        } />
        <span>${d}</span>
      </label>
    `
    )
    .join('')

  dateFilterListEl
    .querySelectorAll('input[type="checkbox"]')
    .forEach((input) => {
      input.addEventListener('change', () => {
        const value = input.value
        if (input.checked) {
          activeDateFilters.add(value)
        } else {
          activeDateFilters.delete(value)
        }
        renderUserFilters()
        renderSubmissionList()
      })
    })
}

const renderClassFilters = () => {
  const classes = getUniqueClasses()
  classFilterListEl.innerHTML = classes
    .map(
      (c) => `
      <label class="teacher-filter-item">
        <input type="checkbox" value="${c}" ${
          activeClassFilters.has(c) ? 'checked' : ''
        } />
        <span>${c}</span>
      </label>
    `
    )
    .join('')

  classFilterListEl
    .querySelectorAll('input[type="checkbox"]')
    .forEach((input) => {
      input.addEventListener('change', () => {
        const value = input.value
        if (input.checked) {
          activeClassFilters.add(value)
        } else {
          activeClassFilters.delete(value)
        }
        renderUserFilters()
        renderSubmissionList()
      })
    })
}

const renderUserFilters = () => {
  const users = getUsersForDatesAndClasses()
  userFilterListEl.innerHTML = users
    .map(
      (name) => `
      <button
        class="teacher-user-btn ${activeUserFilter === name ? 'active' : ''}"
        data-user="${name}"
      >
        ${name}
      </button>
    `
    )
    .join('')

  userFilterListEl.querySelectorAll('.teacher-user-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.user
      if (activeUserFilter === name) {
        activeUserFilter = null
      } else {
        activeUserFilter = name
      }
      renderUserFilters()
      renderSubmissionList()
    })
  })
}

const renderSubmissionList = () => {
  const submissions = getFilteredSubmissions()

  if (submissions.length === 0) {
    submissionListEl.innerHTML =
      '<p class="teacher-empty-message">선택한 조건에 해당하는 제출 데이터가 없습니다.</p>'
    projectCodeViewEl.textContent =
      '# 제출 데이터를 선택하면 이 영역에 프로젝트 코드가 표시됩니다.'
    reflectionViewEl.textContent =
      '제출 데이터를 선택하면 이 영역에 수업 성찰 내용이 표시됩니다.'
    drawingViewEl.innerHTML =
      '<div class="teacher-drawing-placeholder">수업 후기 그림이 이 영역에 표시됩니다.</div>'
    selectedSubmissionId = null
    return
  }

  submissionListEl.innerHTML = submissions
    .map(
      (s) => `
      <div class="teacher-submission-item ${
        selectedSubmissionId === s.id ? 'selected' : ''
      }" data-id="${s.id}">
        <div class="teacher-submission-main">
          <div class="teacher-submission-name">${s.userName}</div>
          <div class="teacher-submission-meta">${s.date} ${s.submittedAt}</div>
          <div class="teacher-submission-class">${s.className}</div>
        </div>
        <button class="teacher-delete-btn" data-id="${s.id}">삭제</button>
      </div>
    `
    )
    .join('')

  submissionListEl
    .querySelectorAll('.teacher-submission-item')
    .forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('teacher-delete-btn')) return
        const id = item.dataset.id
        selectedSubmissionId = id
        renderSubmissionList()
        renderDetailPanels(id)
      })
    })

  submissionListEl
    .querySelectorAll('.teacher-delete-btn')
    .forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.dataset.id
        const submission = submissions.find((s) => s.id === id)
        if (!submission) return

        if (!confirm(`정말로 "${submission.userName}" 학생의 제출 데이터를 삭제하시겠습니까?`)) {
          return
        }

        try {
          await deleteDoc(doc(db, 'reflections', id))
          if (submission.projectCodePath) {
            try {
              const fileRef = storageRef(storage, submission.projectCodePath)
              await deleteObject(fileRef)
            } catch (storageErr) {
              console.warn('Storage 파일 삭제 실패 (무시됨):', storageErr)
            }
          }

          const index = submissions.findIndex((s) => s.id === id)
          if (index !== -1) {
            submissions.splice(index, 1)
          }

          if (selectedSubmissionId === id) {
            selectedSubmissionId = null
            projectCodeViewEl.textContent =
              '# 제출 데이터를 선택하면 이 영역에 프로젝트 코드가 표시됩니다.'
            reflectionViewEl.textContent =
              '제출 데이터를 선택하면 이 영역에 수업 성찰 내용이 표시됩니다.'
            drawingViewEl.innerHTML =
              '<div class="teacher-drawing-placeholder">수업 후기 그림이 이 영역에 표시됩니다.</div>'
          }

          activeDateFilters = new Set()
          activeClassFilters = new Set()
          activeUserFilter = null
          renderDateFilters()
          renderClassFilters()
          renderUserFilters()
          renderSubmissionList()
        } catch (err) {
          console.error('데이터 삭제 오류:', err)
          alert('데이터 삭제 중 오류가 발생했습니다.')
        }
      })
    })
}

const renderDetailPanels = async (id) => {
  const submission = submissions.find((s) => s.id === id)
  if (!submission) return

  projectCodeViewEl.textContent = '# 프로젝트 코드를 불러오는 중입니다...'

  if (submission.projectCodePath) {
    try {
      const ref = storageRef(storage, submission.projectCodePath)
      let url
      try {
        url = await getDownloadURL(ref)
      } catch (urlErr) {
        console.error('Storage URL 가져오기 실패:', urlErr)
        projectCodeViewEl.textContent =
          `# Storage URL 가져오기 실패: ${urlErr.message}\n경로: ${submission.projectCodePath}`
        return
      }

      try {
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }
        const codeText = await res.text()
        projectCodeViewEl.textContent = codeText
      } catch (fetchErr) {
        console.error('파일 내용 가져오기 실패:', fetchErr)
        projectCodeViewEl.textContent =
          `# 파일 내용 가져오기 실패: ${fetchErr.message}\nURL: ${url.substring(0, 100)}...`
      }
    } catch (err) {
      console.error('프로젝트 코드 불러오기 오류:', err)
      projectCodeViewEl.textContent =
        `# 프로젝트 코드를 불러오는 중 오류가 발생했습니다.\n오류: ${err.message}\n경로: ${submission.projectCodePath}`
    }
  } else {
    projectCodeViewEl.textContent =
      '# 제출된 프로젝트 코드 경로가 없습니다.'
  }

  reflectionViewEl.textContent =
    submission.reflectionText || '수업 성찰 내용이 제출되지 않았습니다.'

  if (submission.drawingUrl) {
    drawingViewEl.innerHTML = `<img src="${submission.drawingUrl}" alt="수업 후기 그림" class="teacher-drawing-image" />`
  } else {
    drawingViewEl.innerHTML =
      '<div class="teacher-drawing-placeholder">수업 후기 그림이 제출되지 않았습니다.</div>'
  }
}

loadSubmissionsFromFirebase()






