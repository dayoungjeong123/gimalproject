# 한글 주석 보존 가이드

## 📌 왜 이 방식이 한글 깨짐을 방지하는가?

### 1. **Firestore에 문자열로 저장**
- Firebase Firestore는 UTF-8 인코딩을 기본으로 사용
- 코드를 문자열로 저장하면 자동으로 UTF-8로 저장됨
- 별도의 인코딩 변환 과정이 없어 데이터 손실 위험 최소화

### 2. **Python에서 UTF-8 명시적 저장**
```python
# ❌ 잘못된 방법 (시스템 기본 인코딩 사용, Windows는 CP949)
with open('file.py', 'w') as f:
    f.write(code)

# ✅ 올바른 방법 (UTF-8 명시)
with open('file.py', 'w', encoding='utf-8') as f:
    f.write(code)
```

### 3. **파일 최상단 인코딩 선언**
```python
# -*- coding: utf-8 -*-
```
- Python 인터프리터에게 파일이 UTF-8로 인코딩되었음을 명시
- 한글 주석을 올바르게 해석하도록 보장

## 🔄 데이터 흐름

```
웹 브라우저 (UTF-8)
    ↓
Firestore (UTF-8 문자열로 저장)
    ↓
Python 스크립트 (Firestore에서 읽기)
    ↓
파일 저장 (encoding='utf-8' 명시)
    ↓
.py 파일 (UTF-8, 한글 주석 보존 ✅)
```

## ⚠️ 주의사항

### ❌ 하지 말아야 할 것
1. **Firebase Storage에 .py 파일 업로드**
   - Storage는 바이너리 파일 저장에 최적화
   - 인코딩 변환 과정에서 문제 발생 가능

2. **인코딩 미지정 파일 저장**
   ```python
   # ❌ 시스템 기본 인코딩 사용 (Windows: CP949)
   with open('file.py', 'w') as f:
       f.write(code)
   ```

3. **CP949 인코딩 사용**
   ```python
   # ❌ 한글 깨짐 발생
   with open('file.py', 'w', encoding='cp949') as f:
       f.write(code)
   ```

### ✅ 올바른 방법
1. **Firestore에 문자열로 저장** (웹)
2. **UTF-8 명시적 저장** (Python)
3. **파일 최상단 인코딩 선언 추가**

## 📝 실제 사용 예시

### 웹에서 저장 (JavaScript)
```javascript
await addDoc(collection(db, 'reflections'), {
  projectCode: code,  // 문자열로 그대로 저장
  // ...
})
```

### Python에서 다운로드
```python
with open('output.py', 'w', encoding='utf-8') as f:
    f.write('# -*- coding: utf-8 -*-\n')
    f.write('# 학생명: 김다영\n')
    f.write(data['projectCode'])  # Firestore에서 읽은 코드
```

## 🎯 결과

- ✅ 한글 주석이 완벽하게 보존됨
- ✅ 모든 플랫폼(Windows, Mac, Linux)에서 동일하게 작동
- ✅ Python 인터프리터가 한글 주석을 올바르게 인식
