# -*- coding: utf-8 -*-
"""
Firebase Firestore에서 학생 제출물을 다운로드하여
한글 주석이 깨지지 않는 .py 파일로 저장하는 스크립트

사용법:
1. pip install firebase-admin
2. Firebase 서비스 계정 키 파일 경로를 설정
3. python download_submissions.py
"""

import firebase_admin
from firebase_admin import credentials, firestore
import os
from datetime import datetime

# ============================================
# 🔧 설정
# ============================================
# Firebase 서비스 계정 키 파일 경로
SERVICE_ACCOUNT_KEY_PATH = 'path/to/your/serviceAccountKey.json'

# 다운로드할 컬렉션 이름
COLLECTION_NAME = 'reflections'

# 저장할 디렉토리
OUTPUT_DIR = 'submissions'

# ============================================
# 🚀 Firebase 초기화
# ============================================
def init_firebase():
    """Firebase Admin SDK 초기화"""
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
        firebase_admin.initialize_app(cred)
    return firestore.client()

# ============================================
# 📥 제출물 다운로드 함수
# ============================================
def download_submissions(db, output_dir=OUTPUT_DIR):
    """
    Firestore에서 제출물을 읽어 .py 파일로 저장
    
    Args:
        db: Firestore 클라이언트
        output_dir: 저장할 디렉토리 경로
    """
    # 출력 디렉토리 생성
    os.makedirs(output_dir, exist_ok=True)
    
    # Firestore에서 모든 제출물 가져오기
    reflections_ref = db.collection(COLLECTION_NAME)
    docs = reflections_ref.stream()
    
    saved_count = 0
    error_count = 0
    
    for doc in docs:
        try:
            data = doc.to_dict()
            doc_id = doc.id
            
            # 필수 필드 확인
            if 'projectCode' not in data or not data['projectCode']:
                print(f"⚠️  문서 {doc_id}: 프로젝트 코드가 없습니다. 건너뜁니다.")
                continue
            
            # 학생 정보 추출
            student_name = data.get('studentName', 'Unknown')
            student_class = data.get('studentClass', 'Unknown')
            student_number = data.get('studentNumber', 'Unknown')
            project_level = data.get('projectLevel', 'unknown')
            
            # 타임스탬프 처리
            created_at = data.get('createdAt')
            if created_at:
                # Firestore Timestamp를 datetime으로 변환
                if hasattr(created_at, 'timestamp'):
                    timestamp = created_at.timestamp()
                    date_str = datetime.fromtimestamp(timestamp).strftime('%Y%m%d_%H%M%S')
                else:
                    date_str = datetime.now().strftime('%Y%m%d_%H%M%S')
            else:
                date_str = datetime.now().strftime('%Y%m%d_%H%M%S')
            
            # 파일명 생성 (안전한 문자만 사용)
            safe_name = "".join(c for c in student_name if c.isalnum() or c in (' ', '-', '_')).strip()
            safe_name = safe_name.replace(' ', '_')
            filename = f"{student_class}_{student_number}_{safe_name}_{project_level}_{date_str}.py"
            
            # 파일 경로
            filepath = os.path.join(output_dir, filename)
            
            # 파일 저장 (UTF-8 인코딩 명시)
            with open(filepath, 'w', encoding='utf-8') as f:
                # UTF-8 인코딩 선언 추가 (한글 주석 보존을 위해 필수)
                f.write('# -*- coding: utf-8 -*-\n')
                f.write(f'# 학생명: {student_name}\n')
                f.write(f'# 반: {student_class}\n')
                f.write(f'# 번호: {student_number}\n')
                f.write(f'# 난이도: {project_level}\n')
                f.write(f'# 제출일시: {date_str}\n')
                f.write(f'# 문서ID: {doc_id}\n')
                f.write('\n')
                # 학생이 제출한 코드 (한글 주석 포함, UTF-8로 저장)
                f.write(data['projectCode'])
            
            print(f"✅ 저장 완료: {filename}")
            saved_count += 1
            
        except Exception as e:
            print(f"❌ 오류 발생 (문서 {doc.id}): {str(e)}")
            error_count += 1
    
    print(f"\n📊 완료: {saved_count}개 파일 저장, {error_count}개 오류")

# ============================================
# 🎯 메인 실행
# ============================================
if __name__ == '__main__':
    print("🔥 Firebase에서 제출물 다운로드 시작...\n")
    
    try:
        # Firebase 초기화
        db = init_firebase()
        print("✅ Firebase 연결 성공\n")
        
        # 제출물 다운로드
        download_submissions(db)
        
    except FileNotFoundError:
        print(f"❌ 오류: 서비스 계정 키 파일을 찾을 수 없습니다: {SERVICE_ACCOUNT_KEY_PATH}")
        print("   Firebase 콘솔에서 서비스 계정 키를 다운로드하고 경로를 설정하세요.")
    except Exception as e:
        print(f"❌ 오류 발생: {str(e)}")
