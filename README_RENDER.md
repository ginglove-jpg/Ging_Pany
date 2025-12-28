# Render 배포 가이드 (요약)

## 1) GitHub에 업로드
- 이 폴더 내용을 그대로 새 GitHub 저장소에 올립니다.

## 2) Render에서 Web Service 생성
- New + -> Web Service
- GitHub repo 연결
- Build Command: `npm install`
- Start Command: `npm start`

## 3) 디스크(영구 저장) 추가
- Persistent Disk 추가
- Mount Path: `/var/data`

## 4) 환경변수
- `DATA_FILE=/var/data/data.json`

## 5) 배포 후
- Render가 준 `https://...onrender.com` 주소가 메인 주소
- 보스는 `/`에서 Start로 방 생성 -> 링크 공유
