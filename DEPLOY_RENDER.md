# Render 배포 가이드 (24시간 사이트)

이 프로젝트는 계획서/방 정보를 `data.json` 파일에 저장합니다.
Render 같은 클라우드에 올릴 때는 **Persistent Disk(영구 디스크)** 를 붙여야 데이터가 유지됩니다.

---

## 0) 준비물
- GitHub 계정
- Render 계정

---

## 1) GitHub에 업로드
1) GitHub에서 새 Repository 생성
2) 이 폴더의 파일/폴더 전부 업로드
- `package.json`, `server.js`, `public/`, `src/`, `render.yaml`가 루트에 있어야 합니다.

---

## 2) Render에서 배포 (Blueprint 사용)
1) Render Dashboard → **New** → **Blueprint**
2) 방금 만든 GitHub repo 선택
3) Render가 `render.yaml`을 읽고 Web Service를 자동 생성합니다.
4) 생성 후 배포가 끝나면, Render가 제공하는 URL로 접속합니다.

`render.yaml`이 자동으로 설정하는 것
- Web Service(Express)
- Disk 마운트: `/var/data`
- 저장 파일: `DATA_FILE=/var/data/data.json`

---

## 3) 사용 방법
- 메인 페이지에서 **보스가 닉네임/비번 입력 → Start(방 생성)**
- 생성된 링크(`/r/XXXXXXXXXX`)를 공유
- 참가자는 링크에서 로그인 후 작성
- 보스만 **종료(365일 잠금)** 버튼이 보이고, 종료 가능

---

## 4) “정확히 1년 뒤 오픈” 동작 방식
- 종료 시각 + 365일을 `unlockAt`으로 저장해 둡니다.
- `unlockAt`이 지난 뒤 누가든 그 링크에 접속하면, 즉시 새 사이클로 자동 전환됩니다.

