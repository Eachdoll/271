# 배포 안내 (Railway + Codex)

## 먼저 알아둘 점: 코덱스는 "서버"가 아닙니다

코덱스(Codex)는 코드를 고치고 명령을 실행해 주는 **작업 도구**입니다.
코덱스 클라우드 작업 환경은 작업이 끝나면 사라지는 **임시 컨테이너**라서, 여기서 앱을 띄워도
작업이 끝나면 앱과 데이터가 같이 없어지고 다른 사람이 접속할 주소도 생기지 않습니다.

그래서 역할을 이렇게 나눕니다.

| 누가 | 하는 일 |
|---|---|
| **Railway** (호스팅) | 앱을 24시간 실행, 접속 주소(https) 제공, 데이터 보관 |
| **코덱스** | 코드 수정 → GitHub에 커밋/푸시 → Railway가 자동으로 재배포 |
| **나** | Railway 최초 설정 1회 (아래 1~7단계, 약 10분) |

한 번 설정해 두면 이후에는 **코덱스에 "○○ 기능 추가해줘"라고 말하고 푸시만 하면 자동 배포**됩니다.

---

## 0. 준비

- 이 코드가 GitHub `eachdoll/271` 저장소의 **main 브랜치**에 있어야 합니다.
  (지금은 `claude/youthful-franklin-xe84pq` 브랜치에 있으니 GitHub에서 PR을 만들어 main에 합치세요.)
- 배포에 필요한 파일은 이미 들어 있습니다: `Dockerfile`, `railway.json`, `.dockerignore`

## 1. Railway 가입

https://railway.com → **Login → GitHub로 로그인**.
볼륨(데이터 저장)을 쓰려면 **Hobby 플랜(월 $5부터)** 이 필요합니다.

## 2. 프로젝트 만들기

**New Project → Deploy from GitHub repo → `eachdoll/271`** 선택.
(저장소가 안 보이면 *Configure GitHub App*에서 이 저장소 접근을 허용)

## 3. 폴더 지정 ← 중요

서비스 클릭 → **Settings → Source → Root Directory** = `work-process-app`

(저장소에 다른 프로젝트도 있어서, 이 폴더만 배포하도록 지정해야 합니다.
`railway.json`이 Dockerfile 빌드를 자동으로 선택합니다.)

## 4. 데이터 저장공간(Volume) 연결 ← 가장 중요

서비스 위에서 **우클릭(또는 ⌘K) → Add Volume** → **Mount Path** = `/data`

> ⚠ 이걸 빼먹으면 **재배포할 때마다 모든 데이터(가입자·발주·사진)가 사라집니다.**

## 5. 환경변수

서비스 → **Variables** 탭 → 추가:

| 이름 | 값 | 설명 |
|---|---|---|
| `DATA_DIR` | `/data` | 데이터 저장 위치 (Dockerfile 기본값도 /data) |
| `INVITE_CODE` | `sst3554766` | **처음 실행할 때만** 쓰이는 초대코드. 이후엔 관리자 화면에서 변경 |

`PORT`는 Railway가 자동으로 넣어 주므로 설정하지 않습니다.

## 6. 접속 주소 만들기

**Settings → Networking → Generate Domain** → `https://○○○.up.railway.app` 주소가 생깁니다.
배포 상태가 **Active(초록)** 가 되면 접속하세요.

## 7. 관리자 가입 ← 가장 먼저

주소로 들어가 **가입** 탭에서 `이치원 / 비밀번호 / sst3554766` 으로 가입.
**처음 가입한 사람이 관리자**입니다. 다른 사람에게 주소를 알리기 전에 꼭 먼저 가입하세요.
그다음 `관리자 설정`에서 품질·개발(연구소)·생산 담당자 권한을 지정합니다.

---

## 이후 코덱스로 수정·배포하기

코덱스에 이렇게 말하면 됩니다:

```
eachdoll/271 저장소의 work-process-app 폴더 작업이야. AGENTS.md를 먼저 읽어.
(원하는 수정 내용)
수정 후 npm test 통과 확인하고 main 브랜치에 커밋해줘.
```

main에 푸시(또는 PR 머지)되면 Railway가 자동으로 다시 빌드·배포합니다. 데이터는 Volume에 있어 유지됩니다.

> DB 표(컬럼)를 바꾸는 수정이라면 "기존 데이터가 유지되도록 ALTER TABLE로 마이그레이션해줘"라고 덧붙이세요.

## 배포가 실패할 때 코덱스에 할 말

Railway 서비스 → **Deployments → 실패한 배포 → View Logs** 내용을 복사해서:

```
work-process-app을 Railway에 배포했는데 아래 로그로 실패했어. 원인 찾아서 고쳐줘.
(로그 붙여넣기)
```

## 백업

데이터는 Volume의 `/data` 안에 있습니다 (`app.db` = DB, `uploads/` = 세탁 사진).

Railway에서 **Volume 클릭 → Backups** 탭에서 백업 일정을 설정하세요 (권장: 매일). 문제가 생기면 같은 화면에서 복원할 수 있습니다.

## (선택) 회사 PC / NAS에서 Docker로 직접 실행

Railway 대신 사내 서버에서 돌리려면 (Docker 설치 필요):

```bash
cd work-process-app
docker build -t work-process-app .
docker run -d --name wpa --restart unless-stopped -p 3000:3000 -v wpa-data:/data -e INVITE_CODE=sst3554766 work-process-app
```

사내망에서 `http://<그 PC의 IP>:3000` 으로 접속합니다.
