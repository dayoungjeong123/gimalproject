/**
 * 웹에서 Firestore에 파이썬 코드를 저장하는 예시 코드
 * 
 * ✅ 핵심 원칙:
 * 1. Firebase Storage에 파일을 저장하지 않음
 * 2. 코드를 문자열(string)로 Firestore에 직접 저장
 * 3. 별도의 인코딩 변환 없이 그대로 저장 (웹은 기본 UTF-8)
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebaseConfig' // Firebase 설정 파일

/**
 * 프로젝트 코드를 Firestore에 저장
 * 
 * @param {string} code - 학생이 작성한 파이썬 코드 (한글 주석 포함)
 * @param {string} studentName - 학생 이름
 * @param {string} studentClass - 반
 * @param {string} studentNumber - 번호
 * @param {string} projectLevel - 프로젝트 난이도
 */
async function saveProjectCodeToFirestore(code, studentName, studentClass, studentNumber, projectLevel) {
  try {
    // Firestore에 문서 추가
    // 코드는 문자열로 그대로 저장 (UTF-8, 한글 주석 보존)
    const docRef = await addDoc(collection(db, 'reflections'), {
      studentName: studentName,
      studentClass: studentClass,
      studentNumber: studentNumber,
      projectLevel: projectLevel,
      // ✅ 핵심: 코드를 문자열로 직접 저장
      // 별도의 인코딩 변환 없이 그대로 저장하면 UTF-8로 저장됨
      projectCode: code,
      createdAt: serverTimestamp()
    })
    
    console.log('✅ 제출물이 Firestore에 저장되었습니다. 문서 ID:', docRef.id)
    return docRef.id
    
  } catch (error) {
    console.error('❌ Firestore 저장 오류:', error)
    throw error
  }
}

// 사용 예시
async function submitProject() {
  const code = `# 한글 주석이 포함된 파이썬 코드
# 학생: 김다영
# 반복문을 사용한 구구단 출력

for i in range(1, 10):
    for j in range(1, 10):
        print(f"{i} x {j} = {i * j}")
    print()  # 줄바꿈
`

  await saveProjectCodeToFirestore(
    code,                    // 파이썬 코드 (문자열)
    '김다영',                // 학생 이름
    '1-10',                  // 반
    '12',                    // 번호
    'intermediate'           // 난이도
  )
}

// 실제 사용 시 (예: 제출 버튼 클릭 이벤트)
document.getElementById('submit-btn').addEventListener('click', async () => {
  const code = document.getElementById('code-editor').value
  
  if (!code || !code.trim()) {
    alert('코드를 작성해주세요!')
    return
  }
  
  try {
    await saveProjectCodeToFirestore(
      code,
      studentInfo.name,
      studentInfo.klass,
      studentInfo.number,
      projectLevel
    )
    alert('제출이 완료되었습니다!')
  } catch (error) {
    alert('제출 중 오류가 발생했습니다.')
  }
})
