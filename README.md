# 비즈업리드 (BizupLead)

랜딩페이지 제작 → 상담 신청 DB 수집 → 자동 알림 → 상담 관리 → 성과 분석 → AI 개선을 하나의 워크스페이스에서 운영하는 리드 운영 플랫폼.
공개 서비스 분석 PRD(`SuperLead_Public_Reverse_PRD_2026-11-13.md`)의 요구사항을 독자 제품으로 구현했다.

스택: Next.js 16(App Router) · PostgreSQL(Supabase) · Vercel 배포 기준.

## 로컬 실행

```bash
npm install
npm run seed     # (선택) 데모 데이터: demo@bizuplead.kr / demo1234!
npm run dev      # http://localhost:3000
```

- 환경 변수 없이 실행하면 내장 Postgres(PGlite)가 `data/pglite`에 만들어지고 스키마가 자동 적용된다. 운영(Supabase)과 같은 SQL 방언으로 동작한다.
- 내장 DB는 한 번에 한 프로세스만 열 수 있다. `npm run seed`는 개발 서버를 끈 상태에서 실행한다.
- Node.js 22 이상. `data/`(DB·업로드 이미지·로컬 암호화 키)는 git에서 제외된다.
- `npm test` 핵심 로직 테스트(내장 Postgres) · `npm run typecheck` · `npm run lint` · `npm run build`

## Supabase + Vercel 배포

1. **Supabase 프로젝트 생성** 후 Connect 화면에서 **Transaction pooler**(포트 6543) 연결 문자열을 복사한다.
2. **스키마 적용** — `.env.example`을 `.env.local`로 복사해 `DATABASE_URL`을 채우고 실행한다. 여러 번 실행해도 안전하다.
   ```bash
   npm run db:migrate
   ```
   테이블 31개와 인덱스를 만들고, 모든 테이블에 RLS를 켜고(정책 없음 → anon 키로는 접근 불가), 업로드 이미지용 비공개 Storage 버킷 `uploads`를 만든다.
3. **Vercel 프로젝트에 환경 변수 등록** (아래 표의 "Vercel 필수" 항목).
4. **배포** — GitHub 저장소를 Vercel에 연결하면 된다. 별도 빌드 설정은 필요 없다.
5. **예약 발송 스케줄러 설정** — 아래 "예약 발송" 참고.

### 환경 변수

| 변수 | Vercel | 설명 |
|---|---|---|
| `DATABASE_URL` | 필수 | Supabase Transaction pooler 연결 문자열. 없으면 로컬 내장 DB를 쓴다(Vercel에서는 오류) |
| `APP_SECRET` | 필수 | 연락처 암호화·해시 키(`openssl rand -hex 32`). **분실하면 저장된 연락처를 복호화할 수 없으니 백업한다.** 로컬에서만 `data/.secret`에 자동 생성된다 |
| `SUPABASE_URL` | 필수 | `https://<project-ref>.supabase.co` (업로드 이미지 저장) |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | Storage 접근용 서버 전용 키. `NEXT_PUBLIC_` 접두사를 붙이지 않는다 |
| `CRON_SECRET` | 필수 | `/api/cron/tick` 보호. Vercel Cron이 Bearer 헤더로 자동 전송한다 |
| `ANTHROPIC_API_KEY` | 선택 | 설정 시 Claude(`claude-opus-5-5`)가 기획서·채팅 수정·이탈 개선 제안을 생성. 없으면 규칙 기반 템플릿 |
| `WEBHOOK_SECRET` | 선택 | `/api/webhooks/payment`, `/api/webhooks/message-provider` 활성화(`x-webhook-secret` 헤더) |
| `PAYMENT_PROVIDER` | 선택 | 기본 `mock`. 다른 값이면 콘솔의 모의 결제 버튼이 비활성화된다 |
| `DB_POOL_MAX` | 선택 | 인스턴스당 DB 연결 수(기본 3) |
| `SUPABASE_STORAGE_BUCKET` | 선택 | 기본 `uploads` |
| `BIZUP_DATA_DIR` / `BIZUP_PGLITE_DIR` | 로컬 전용 | 로컬 데이터 디렉터리 / 내장 DB 경로 |

### 예약 발송

후속 메시지·24시간 재알림은 `/api/cron/tick`이 호출될 때 처리된다. 신규 접수 알림은 접수 응답 직후(`after()`) 바로 처리되므로 스케줄러와 무관하다.

- `vercel.json`에는 모든 요금제에서 배포가 실패하지 않도록 **하루 1회** 크론만 넣어 두었다. 이것만으로는 "1시간 뒤 후속 메시지"가 최대 하루 늦는다.
- **권장: Supabase pg_cron으로 1분마다 호출** (무료 요금제 가능). SQL Editor에서 한 번 실행한다.
  ```sql
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  select cron.schedule('bizuplead-tick', '* * * * *', $$
    select net.http_post(
      url := 'https://<배포 도메인>/api/cron/tick',
      headers := '{"Authorization": "Bearer <CRON_SECRET 값>"}'::jsonb
    );
  $$);
  ```
- Vercel Pro라면 `vercel.json`의 schedule을 `* * * * *`로 바꿔도 된다.
- 상시 실행 서버(`next start`)에서는 서버 내 30초 타이머가 대신 처리한다.

여러 인스턴스가 동시에 실행돼도 작업은 한 번만 집행된다(작업 선점 UPDATE, 크레딧 지갑 행 잠금, 멱등 키 UNIQUE + `ON CONFLICT`).

## 구조

```
src/lib/            도메인 로직(Next 비의존, 테스트 대상)
  db.ts             Postgres 연결(Supabase=postgres.js / 로컬=PGlite)·스키마·트랜잭션·감사 로그·요청 제한
  storage.ts        업로드 이미지 저장(Supabase Storage / 로컬 디스크)
  accounts.ts       가입/로그인/세션, 체험·구독 상태, 역할별 권한, 테넌트 범위 SQL
  campaigns.ts      고객사·캠페인·리드 상태·자동화 시나리오·광고주 공유 링크
  landing.ts        랜딩 콘텐츠 모델·기본 템플릿·발행 검증 (클라이언트 공용)
  landings.ts       랜딩 CRUD·발행 버전·동의 문구 버전·공개 조회
  leads.ts          폼 접수(서버 검증·멱등), 목록/검색, 상태 변경, 메모
  messaging.ts      알림 예약·발송·대체 발송·재시도·취소 (공급자 어댑터)
  credits.ts        크레딧 원장(차감·환급 멱등)
  tracking.ts / analytics.ts   이벤트 수집 / 퍼널·추이·채널·체류 집계
  ai.ts / studio*.ts / improve.ts   AI 기획·장 이미지(SVG)·이탈 개선 제안
src/app/app/        운영 콘솔(서버 컴포넌트 + 서버 액션)
src/app/p/[slug]    공개 랜딩 · src/app/share/[token] 광고주 전용 화면
src/app/api/        공개 접수·추적·내보내기·업로드·크론·웹훅
scripts/            migrate.ts(스키마 적용) · seed.ts(데모 데이터, 외부 DB에서는 --force 필요)
```

DB 접근 규칙: 모든 쿼리 함수(`q/one/run/tx`)는 비동기다. `await` 누락은 ESLint(`no-floating-promises`)가 오류로 잡는다. SQL은 `?` 자리표시자로 쓰고, 트랜잭션 안에서 제약 위반을 try/catch로 넘기지 말고 `ON CONFLICT`를 쓴다. 스키마 변경은 `src/lib/db.ts`의 `SCHEMA`에 멱등 구문(`IF NOT EXISTS`)으로 추가하고 `npm run db:migrate`를 다시 실행한다.

## 정책 결정 (PRD의 "확정 필요" 항목)

- **크레딧 유효기간**: 마지막 충전일로부터 5년(약관 기준)으로 통일. 무상 크레딧을 먼저 차감.
- **퍼널**: 단계별 이벤트가 발생한 고유 세션 수(세션 내 순서 비강제). 전환율 = 신청 세션 ÷ 방문 세션.
- **섹션 8종**: 공개 자료에 없는 1종은 "신청 버튼(CTA)" 섹션으로 채움. 폼 입력 8종은 한 줄 글·전화·이메일·드롭다운·단일 선택·복수 선택·긴 글·날짜.
- **문자 대체 발송 단가**: 미공개라 알림톡과 같은 30크레딧으로 가정(`src/lib/pricing.ts`).
- **광고성 메시지**: 별도 수신 동의자에게만 예약, 본문 `(광고)` 표기 강제, 21~08시(KST) 발송 연기.
- **블로그형 랜딩**: '광고' 표시 상시 노출, 댓글·공감 기본값은 비어 있음(실제 고객 반응만 등록).

## 시뮬레이션·미구현

- **메시지 발송(알림톡·문자·메일)**: mock 공급자. 실제로 발송되지 않는다. `messaging.ts`의 `MessageProvider`를 구현해 교체.
  시뮬레이션 규칙: 번호가 `0000`으로 끝나면 수신 불가, `0100000`으로 시작하면 카카오톡 미사용(문자 대체), `9999`로 끝나면 일시 장애.
- **결제**: 모의 결제. PG 연동 시 `/api/webhooks/payment`로 구독 활성화·충전 처리.
- **AI 이미지**: 사진 생성 모델이 아니라 디자인 템플릿(SVG) 렌더링 → 브라우저에서 PNG 변환.
- **구글 시트**: OAuth 연동 대신 Apps Script 웹앱 URL로 JSON POST.
- **당근 픽셀**: 스크립트 주소·이벤트명은 실제 계정으로 검증 필요.
- 미구현: 카카오 로그인, 비밀번호 재설정, 회원 탈퇴, 구독 종료 30일 후 자동 파기 배치, 지역 통계, 자체 도메인, PRD 16장(교육 퍼널 확장).
- 인증은 자체 세션(쿠키) 방식이다. Supabase Auth는 사용하지 않는다.
- 업로드 이미지는 4MB 이하(Vercel 함수 본문 한도).
