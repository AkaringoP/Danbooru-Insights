# DanbooruInsights - Claude 작업 지침

## 개요
Danbooru 프로필/위키/아티스트 페이지에 GitHub 스타일 기여 그래프와 분석 대시보드를 삽입하는 Tampermonkey 유저스크립트.
GitHub 저장소: `AkaringoP/Danbooru-Insights`

## 코드 스타일
- TypeScript: [GTS (Google TypeScript Style Guide)](https://google.github.io/styleguide/tsguide.html) 준수
- `npm run lint` / `npm run fix` 로 강제

## 작업 원칙
- **읽기 전에 검색**: 파일 통째로 읽지 말고 Grep/Glob 으로 대상부터 찾아. 타겟 검색이 가능하면 그걸 우선
- **동작 변경 전 보고**: 사용자에게 보이는 기존 동작에 영향 주는 변경은 진행 전에 반드시 확인 받기
- **편집 직후 self-verify** (left-shifted feedback): 변경한 파일에 대해 즉시 `npx vitest run <changed-file>` 실행. 작업 끝나서가 아니라 도중에. 회귀 누적 전에 잡힘.
- **자체 판단 말고 harness 신뢰**: 아래 Evaluator Rubric 안 돌리고 "괜찮아 보임" 선언 금지. 기계적 체크가 직관보다 우선
- **태스크마다 변경 파일 보고**: 어떤 파일이 어떻게 바뀌었는지 명확히
- **한 번에 하나의 태스크**: 한 세션에서 여러 태스크 섞지 말기
- **UserScript 헤더 보존**: `@version`, `@match`, `@grant` 같은 메타데이터 블록 임의로 수정 금지 (`vite.config.ts` 의 monkey 플러그인이 관리)

## 핵심 규칙 (기계적 강제 X — agent 가 직접 적용)
- DB 스키마 변경 시 → `database.ts` 의 version 번호 bump (Dexie.js 마이그레이션 요건)
- 새 CSS 클래스는 `di-` prefix 사용 (Danbooru Insights 네임스페이스)
- 기계적으로 강제되는 규칙들 (raw `fetch` 금지, `[key: string]: any` 금지, 의존성 방향, build/lint/test 통과, 함수 복잡도 cap, dead code) 은 아래 **Evaluator Rubric** 에 정리되어 있고 pre-commit gate 체인으로 자동 실행됨 — 코드 리뷰나 계획에서 중복 언급하지 말고 gate 를 믿어

## Multi-Model 워크플로우

**기본**: main 세션은 **Opus 4.6** 으로 동작. Opus 가 오케스트레이션, 결정, 리뷰, 작은~중간 구현 직접 처리. **Sonnet 4.6** 은 아래 위임 기준에 맞을 때만 subagent 로 호출 (`Agent` 툴, `model="sonnet"`).

근거: 이건 Claude Code 구독 환경이지 측정형 API 가 아님. Opus 토큰은 rate-limit quota 에서 빠짐 — per-token 과금이 아님. quota 위험이 없는 한 main loop 에 최강 모델 유지해도 비용 추가 없음. 위임의 목적은 **Opus quota 절약** 과 **main context 정리** 이지 비용 절감 아님.

### Opus (main) 가 직접 처리하는 경우
- 아키텍처, 알고리즘, 설계 결정
- 디버깅 (가설 → 검증 → 수정 루프)
- 어떤 변경이든 끝나면 코드 리뷰
- 5 파일 미만의 편집 또는 도중에 판단이 필요한 작업
- main context 에 남아있어야 후속 작업 가능한 것
- 메타 문서 (`CLAUDE.md`, `TASK.md`, `PLAN.md`) 의 논의/계획/갱신

### Sonnet subagent 에 위임하는 경우
다음 조건을 **모두** 만족할 때만 위임 — 아니면 Opus 가 직접:
- **기계적** 작업 (bulk find/replace, 알려진 패턴을 여러 파일에 적용, dead code 제거, 명확한 spec 으로 scaffolding)
- spec 이 **명확** 해서 작업 도중 main 세션의 추가 판단이 필요 없음
- 범위가 **5 파일 이상** OR main context 에 **100 줄 이상의 noisy output** 이 쌓일 작업 (예: 결과 요약만 필요한 광범위 코드 탐색)
- 결과물이 Opus 가 한 번에 리뷰 가능한 **diff 또는 요약**

위임 시 **self-contained 프롬프트** 작성: subagent 는 이 대화를 못 봄. 결정 사항/spec, 대상 파일·패턴, 제약, 보고할 내용을 다 적어 보내기

### 태스크 처리 절차
1. Opus 가 태스크 항목 읽고 위 기준으로 **direct** 인지 **delegate** 인지 결정
2. **Direct path**: Opus 가 구현 → 해당 Evaluator Rubric gate 직접 실행 → 변경 파일 보고
3. **Delegate path**: Opus 가 self-contained 프롬프트 작성 → `Agent(model="sonnet", ...)` 호출 → 반환된 diff 리뷰 → Evaluator Rubric gate 실행 → 변경 파일 보고
4. 리뷰 통과 후 다음 태스크로

### Rate-limit fallback
세션 중 Opus quota 가 소진 위험이면 `/model sonnet` 으로 main 세션 자체를 Sonnet 으로 전환하고 inverted 패턴으로 진행 (Sonnet main, 위임 없음). 기본이 아니라 복구 모드로 취급

### 태스크 문서 규칙
`TASK.md`, `PLAN.md`, 기타 태스크 목록 문서 작성/갱신 시 **모든 태스크 항목은 실행 경로** 를 다음 중 하나로 표시 **필수**:
- `Direct (Opus)` — Opus main 세션이 직접 구현
- `Delegate (Sonnet)` — Opus 가 Sonnet subagent 에 위임 후 리뷰

선택이 자명하지 않으면 근거를 간단히 기록. 이래야 세션 간에 파이프라인 재현성 유지됨

## Git 브랜치 전략
- `main` — 안정 릴리즈만. 항상 배포 가능 상태
- `feature/*` — 새 기능/개선. `main` 에서 분기, `main` 으로 머지
- `hotfix/*` — 긴급 버그 수정. `main` 에서 분기, `main` 으로 머지
- `main` 에 직접 커밋 금지
- 브랜치 명: `feature/<short-description>` / `hotfix/<short-description>`

## Build & Dev
- `npm run dev` — Vite dev 서버 (HMR)
- `npm run build` — `vitest run && tsc && vite build` → `dist/danbooruinsights.user.js` 출력
- `npm run lint` / `npm run fix` — GTS lint / auto-fix
- `npm run test` — Vitest 단위 테스트 (현재 583 cases)
- `npm run check:dead` — knip dead-code detection (Phase 6 gate)
- `npm run test:e2e` — Playwright e2e 테스트 (test/e2e/, 시각 회귀 baseline 포함)

## 도메인 용어집
| 용어 | 의미 |
|---|---|
| Grass | GitHub 스타일 캘린더 히트맵 (기여 그래프) |
| Quick Sync | ≤1200 포스트 유저용 빠른 경로 — 순차 cursor pagination |
| Full Sync | 큰 유저용 표준 pagination + 재시도 |
| Delta Sync | 태그 분석 증분 갱신 — 첫 100 포스트 받아서 diff ≥ 50 면 재집계 |
| Piestats | 파이 차트용 캐시된 집계 통계 (24h 만료) |

## 아키텍처

### Entry Point
`src/main.ts` → `main()` → URL 경로 기반 라우팅:
- **Profile 모드** (`/users/*`, `/profile`): `GrassApp` + `UserAnalyticsApp` 실행
- **Tag 모드** (`/wiki_pages/*`, `/artists/*`): `TagAnalyticsApp` 실행

### 데이터 흐름
1. `ProfileContext` / `detectCurrentTag()` → 대상 (유저 or 태그) 식별
2. `DataManager` / `AnalyticsDataManager` → Danbooru API 호출 + IndexedDB 캐싱
3. `GraphRenderer` / App 클래스 → D3.js / CalHeatmap 으로 시각화 렌더링

### 레이어 구조 (기계적 강제 — [test/architecture.test.ts](test/architecture.test.ts) 참조)
의존 방향: `core/ → ui/ → apps/`. 하위 레이어가 상위 레이어를 import 하면 안 됨

| 레이어 | 역할 | 예시 |
|---|---|---|
| `src/core/` | 데이터 레이어 — API, DB, rate limiting, settings, quota, 도메인 유틸 | `data-manager.ts`, `analytics-data-manager.ts`, `database.ts`, `rate-limiter.ts`, `profile-context.ts`, `settings.ts`, `tab-coordinator.ts`, `quota-manager.ts`, `global-tag-stats.ts`, `sub-tag-resolver.ts`, `threshold-tuner.ts`, `scroll-lock.ts`, `logger.ts`, `perf-logger.ts` |
| `src/ui/` | 재사용 가능한 UI primitives — 앱 오케스트레이션 X | `graph-renderer.ts`, `settings-popover.ts`, `approval-detail-popover.ts`, `post-hover-card.ts`, `dashboard-footer.ts`, `modal.ts`, `popover-utils.ts`, `theme-palette.ts`, `tag-cloud-widget.ts`, `subtag-breakdown-tooltip.ts`, `widget-locked-placeholder.ts`, `threshold-preview-modal.ts`, `toast.ts`, `two-step-tap.ts` |
| `src/apps/` | 앱 오케스트레이션 — core + ui 조합 | `grass-app.ts`, `user-analytics-app.ts`, `user-analytics-data.ts`, `user-analytics-charts.ts`, `user-analytics-pie-helpers.ts`, `user-analytics-scatter.ts`, `tag-analytics-app.ts`, `tag-analytics-data.ts`, `tag-analytics-charts.ts`, `created-tags-widget.ts`, `progress-tracker.ts`, `widget-gates.ts` |
| `src/dev/` | 개발자 진단 도구 — 격리된 dev-only 모듈 | `diagnostic.ts` |
| `src/` (루트) | Entry, 공유 types/utils/config | `main.ts`, `types.ts`, `utils.ts`, `config.ts`, `styles.ts`, `version.ts` |

## 주요 제약사항
- `@grant none` — GM_* API 사용 불가
- 브라우저 환경 한정 (Node.js API 사용 불가)
- 외부 라이브러리는 `@require` / `externalGlobals` 로 로드 (Vite 빌드 프로젝트지만 — 번들러가 import 처리, 런타임 의존은 외부 유지)
- `d3` 는 `any` 로 타입 지정 — `@types/d3` 추가 금지 (앱 파일 타이핑 깨짐). d3 호출 사이트에서 raw `any` 대신 `src/types.ts` 의 `D3Any` 타입 alias 사용. `@typescript-eslint/no-explicit-any` 가 disabled 되는 유일한 곳
- `database.ts` 의 Dexie 테이블은 `src/types.ts` 에 정의된 실제 row 인터페이스 (`DailyCountRecord`, `PostRecord` 등) 사용 — **`Table<any>` 금지**. (이전 버전 문서에 `Table<any>` 라고 적혀있었는데 lint-CI initiative 이후로는 outdated)
- App 클래스는 composition 사용 (dataService, chartRenderer) — index signature 금지
- `dist/` 출력은 단일 번들 `.user.js` — 직접 수정 금지

## 외부 의존성 (`@require` / `externalGlobals`)
- **d3.v7** — 차트와 시각화 (전역: `d3`)
- **d3-cloud** — Tag Cloud 워드 클라우드 레이아웃 (전역: `d3.layout.cloud`, `@require` only — externalGlobals 에는 없음)
- **cal-heatmap** — 캘린더 히트맵 (전역: `CalHeatmap`)
- **Dexie.js** — IndexedDB 래퍼 (전역: `Dexie`)

## CSS 관리
- 모든 스타일은 `src/styles.ts` 의 `GLOBAL_CSS` 에 중앙화
- `injectGlobalStyles()` 로 `<style>` 태그 한 번 주입
- CSS 클래스 prefix: `di-` (Danbooru Insights)

## Rate Limiting (RateLimitedFetch)
Token bucket 알고리즘 기반 3-queue 시스템. 정확한 수치는 [src/config.ts](src/config.ts) 의 `CONFIG.RATE_LIMITER` 참조:
- **General Queue**: 8 concurrent requests, 9 req/sec, 0-50ms jitter (v9.6 에서 6/6 → 8/9 으로 상향)
- **Report Queue**: 격리됨, `/reports/` URL 에 3 초 cooldown (`CONFIG.REPORT_COOLDOWN_MS`)
- **TabCoordinator**: 같은 IP 의 멀티탭 환경에서 rps/concurrency 를 분할해 Danbooru 의 10 req/s 서버 상한 안에 유지

## Evaluator Rubric (작업 완료 선언 전 self-evaluation 용)
7 개 gate 모두 통과해야 태스크 완료 보고 가능. 직접 실행해 — 가정 금지

pre-commit hook ([`.githooks/pre-commit`](.githooks/pre-commit), `prepare` 스크립트로 `npm install` 시 자동 wire-up) 이 gate 1–7 을 한 번에 체인: `npm run build && npm run lint && npm run check:dead`. 더 빠른 피드백을 위해 작업 중에 개별 실행해도 됨

| # | Gate | 명령 | 강제 주체 |
|---|---|---|---|
| 1 | Type safety | `tsc --noEmit` (또는 `npm run build`) | TypeScript strict mode |
| 2 | Lint/style | `npm run lint` | GTS (Google TS style) |
| 3 | 테스트 통과 | `npx vitest run` | Vitest |
| 4 | 아키텍처 invariant | (gate 3 가 커버) | [test/architecture.test.ts](test/architecture.test.ts) — 의존 방향, `[key: string]: any` 금지, raw `fetch()` 금지, core/settings.ts 외부에서 legacy NSFW 키 금지, `/counts/posts.json` URL 재롤 금지, ui/popover-utils.ts 외부에서 popover 위치 공식 금지 |
| 5 | 빌드 성공 | `npm run build` | Pre-commit hook (gate 1+3 도 같이 실행) |
| 6 | 복잡도 cap | `npm run lint` | T-26 ESLint 규칙 — `max-lines-per-function: 200` (skipBlankLines+skipComments), `max-depth: 6`, `complexity: 15`, `max-nested-callbacks: 4`. 기존 위반은 inline `// T-26 baseline:` disable; 신규 위반은 차단 |
| 7 | Dead code 없음 | `npm run check:dead` | knip — entry points / project globs / `cal-heatmap` + `eslint` ignored. 미사용 파일/export/type/devDependency 잡음 |

gate 실패 시 root cause 를 고쳐 — whitelist, suppress, work around 금지. 기계적 gate 의 존재 이유는 이런 체크에 LLM 판단을 못 믿어서임 ("Never send an LLM to do a linter's job").

Pre-commit hook 이 이제 authoritative — 예전의 "커밋 전 lint 수동 실행" 규칙은 자동화됨. 작업 도중에는 여전히 개별 gate 돌려가며 left-shifted feedback 유지하되, 최종 보증은 hook 이 함

## 참조 (Level-3 문서 — 필요 시 로드)
- [.claude/rules/api-endpoints.md](.claude/rules/api-endpoints.md) — Danbooru API 엔드포인트 카탈로그
- [.claude/rules/database-schema.md](.claude/rules/database-schema.md) — Dexie.js 테이블 레이아웃 & compound index
- [.claude/rules/sync-strategies.md](.claude/rules/sync-strategies.md) — Grass / User / Tag 동기화 알고리즘
- [.claude/rules/perf-logging.md](.claude/rules/perf-logging.md) — perf-logger 사용법, enable/disable, label namespace
- [test/architecture.test.ts](test/architecture.test.ts) — 아키텍처 규칙의 canonical source
- [docs/audit-remediation.md](docs/audit-remediation.md) — v9.6 audit 6-phase 회고록 (Phase 1-6 helper / guardrail 의 도입 근거)
- [CHANGELOG.md](CHANGELOG.md) — 릴리즈 히스토리 & 버전 컨텍스트

## Active Issues
- **대시보드 hover preview popover** — `feature/dashboard-preview-popover` 진행 중 (v9.7.0 목표). 아이콘 hover 시 네이티브 툴팁 대신 팝오버: (A) 최근 업로드 썸네일(180px variant, status 테두리) + (B) 활동 분포 스트립(11 타입 병렬). 설계·태스크 = PLAN.md / TASK.md (gitignore 로컬). 확정 결정: 배치=아이콘 아래+caret, **폭 440px·5열**(셀 ~80px, 5×2=10 — Stage 3 에서 355/63/20 에서 키움), 활동 스트립 **200 세그먼트**(균등분배 행 `balancedChunks`, 행당 ~80, 셀 `flex:1` 로 각 행 끝까지 채움 → ragged tail 없음, ~3줄; 200=posts.json 조회 상한과 정렬), 라벨=`{rating G/S/Q/E} ▲score ◫general`, **status 테두리는 썸네일에만**(라벨 제외), **ui 60s 캐시**(재hover flicker 방지) + debounce/in-flight dedupe, 최신순=`order` metatag 없이 API 기본(`order:id` 는 오름차순이라 금지), 기존 status div 불변. **click 라우팅 확정**: 총 업로드 **≤30** 유저는 click 시 무거운 모달 대신 **고정 팝오버**(sync/모달 스킵, escape hatch 없음), >30 은 기존 모달. 진행: **Stage 1+2 완료** (DP-10~13, DP-20/21) — hover→preview 팝오버(섹션 A 최근 업로드) + ≤30 업로드 click→pinned + **섹션 B 활동 분포**(11 타입 `mapConcurrent` 병렬, 스트립[최신=왼쪽]+범례, 백그라운드 비차단 로딩; post_versions 는 `search[is_new]` 로 `upload`(업로드)/`edit`(태그편집) 분리 집계). **commentary 업로드-커플링 필터**(`COMMENTARY_UPLOAD_EPSILON_MS=1초` — commentary version 의 post.created_at 과 ±1초 내 v1 은 업로드 동반으로 보고 제외, 업로드가 commentary 로 이중집계되는 것 방지). **Stage 3 진행 중**: 그리드 10개@80px(5×2) + 활동 스트립 200·균등분배 행(끝까지 채움). **기능 목적 = 악성 유저활동 빠른 감지.** 섹션 A 에 **악성 업로드 빨간 라벨**(`isSuspiciousUpload`: score≤-3 OR gentags≤5; rating 은 misrate 판정 불가라 제외) + 섹션 라벨("Recent uploads"/"Activity") 추가. 섹션 B 에 **악성 활동 카테고리 `suspicious`**(`'flagged'` 아님 — status:flagged 와 혼동 회피): deleted/banned OR score≤-3 업로드(post_id 배치조회 `is_deleted,is_banned,score`) + score≤-3 코멘트 → 검정+빨간 inset 테두리(다크모드 가시성)로 재분류, 범례 "Suspicious N", fail-open. + **스트립/범례 hover peer-highlight**(같은 타입 셀 동시 강조, 나머지 디밍 — 위임 핸들러) + **범례 클릭 → 그 타입 Danbooru 인덱스 페이지 새 탭**(`activityTypeIndexUrl`: upload=`/posts?tags=user:`, 나머지=`*_versions?search[*_id]=`; ui 에 `activityHref(type, dist)` 콜백 주입). (인라인 리스트 시도했다가 사용자가 link-out 으로 정정 — per-segment url 작업 되돌림.) **suspicious 클릭은 정확 매칭으로 격상**(`suspiciousPostsUrl`): 악성 업로드의 post_id + 악성 코멘트가 달린 post_id 둘 다 수집(코멘트도 `post_id` 들고 있음 — comment only 에 추가, 사용자 제안), merge window 에서 dedup → `ActivityDistribution.suspiciousPostIds`(200 cap) → 클릭 시 `/posts?tags=id:<csv> status:any` 새 탭. 범례 "Suspicious N" 카운트와 여는 페이지 일치(여러 악성코멘트가 같은 post 공유 시만 차이). id 0개(전부 lookup miss)면 기존 `user:name status:deleted` 폴백. `status:any` 필수(삭제/밴 업로드가 핵심인데 그거 없으면 HTML 인덱스에서 안 보임). + **hover 팝오버 dismiss = linger+fade**(사용자 요청): 커서가 팝오버 밖으로 나가면 `HIDE_GRACE_MS=1000` 동안 그대로 유지 → `FADE_MS=350` opacity fade(`.di-preview-popover--fading`, styles.ts transition 과 동기) → `display:none`. 재진입(`keepOpen`) 시 타이머 취소+클래스 제거로 복원. pinned(클릭) 팝오버는 그대로 즉시 닫힘. (기존 200ms grace 는 아이콘→팝오버 다리용이라 "바로 닫힘"처럼 느껴졌음.) + **범례 인덱스 링크에 `&limit=200` + 가장 오래된 행 `#anchor`**(`activityTypeIndexUrl`/`suspiciousPostsUrl`, = `ACTIVITY_SEGMENT_LIMIT`): 분석한 윈도 전체가 한 페이지에 + `#<prefix>_<id>` 로 **윈도 내 가장 오래된 행으로 스크롤**(분석 경계). anchor id = 세그먼트별 `anchorId`(fetchActivityType=record id / upload=post id / comment=comment id / commentary=version id), `mergeRecentActivity` 가 `ActivityDistribution.oldestAnchorByType`(newest-first → 타입별 마지막=가장 오래됨)로 축약. suspicious 는 `suspiciousPostIds` 의 마지막(=가장 오래됨)으로. **앵커 스킴 전부 라이브 측정 완료**(`ANCHOR_PREFIX` 는 구분자까지 포함해 저장): post 갤러리·comment 는 **언더스코어**(`post_<id>` — LocateInGallery 확인 / `comment_<id>`), `*_versions`·feed 테이블은 전부 Rails **대시** dom_id(`post-version-`/`note-version-`/`wiki-page-version-`/`artist-version-`/`artist-commentary-version-`/`pool-version-`/`forum-post-`/`post-approval-`/`post-appeal-` + `<id>`). (사용자가 각 페이지 콘솔에서 행 id 스킴 측정 → 내 초기 언더스코어 추정 9개 정정.) 틀린 fragment 는 브라우저 무시 → fail-soft. + **범례 라벨 peer-highlight 볼드**(사용자 요청): 스트립 세그먼트 hover OR 범례 라벨 hover 시 해당 타입 범례 라벨 bold(`.di-activity-legend-item--active`) — `applyPeerHighlight` 에 legend 인자 추가, 기존 strip dim 과 동시. **폭 불변**(사용자 요청): 라벨을 `__text` span(`data-text` 고스트)으로 감싸 grid-stack 으로 bold 너비를 미리 예약 → hover 시 실제 700 켜져도 reflow 0. + **섹션 A 우상단 "Blur NSFW" 체크박스**(사용자 요청): rating q/e 썸네일 `blur(10px) grayscale(100%)` opacity 0.3(`.di-preview-thumb--nsfw`, TagAnalyticsApp 방식, 라벨은 안 가림). **통합 플래그 `getNsfwEnabled/setNsfwEnabled` 재사용**(아키텍처상 새 NSFW 키 금지) — 라벨 "NSFW", **체크=NSFW 표시=nsfwEnabled**(User/TagAnalyticsApp "Enable NSFW" 폴라리티와 통일), 기본 꺼짐(nsfw 기본 false → 기본 블러). `data-rating` 을 thumb 에 심고 `applyNsfwBlur(grid)`(`blur=!nsfwEnabled`)가 렌더·토글마다 live 반영. ⚠️ 전역 플래그라 토글 시 다른 컴포넌트(tag analytics, pie boobs 탭)도 다음 렌더에 반영됨(라이브 동기는 안 함). 7 게이트 전부 green (733 tests, knip), **미커밋**. 데스크탑 preview(섹션 A+B) 완성. + **모바일 계층 3개 완료**(전부 touch 전용, 데스크탑 hover/click 경로 불변): ① 헤더 📊 옆 **📋 미니보고서 버튼**(`isTouchDevice()` 일 때만, pinned preview 오픈 — >30 유저는 📊 탭이 모달이라 우회로. ⚙️ 는 `updateHeaderStatus` 가 매번 다시 그리는 el 안이라 📊 옆 안정적 위치 선택) ② **통합 로딩**(touch+pinned): `loadUnified` 가 단일 스피너(`.di-preview-loading`) → A+B `Promise.allSettled` 둘 다 settle 후 한 번에 렌더, 섹션별 스켈레톤 churn 제거 ③ **범례 two-step-tap**(`attachLegendTwoStep`+`createTwoStepTap`+`TapTracker`): 첫 탭=하이라이트(`applyPeerHighlight`), 둘째 탭=`data-href` 페이지 오픈. legend item 의 click→open 은 `!isTouchDevice()` gate. **hover peer-highlight 는 pointer 이벤트(`pointerover`/`pointerleave`, `pointerType==='touch'` 제외)로 항상 wiring** — 터치 가능 데스크탑(`'ontouchstart' in window`=true)에서 마우스 hover 가 hover-clear 를 못 받던 버그 수정(예전엔 isTouchDevice 면 two-step 만 걸어서 마우스 떼도 안 풀림). pointer 타입으로 마우스/펜↔터치 구분되니 two-step 과 충돌 없이 공존. **2차 수정**: 범례는 gap(4~10px)·2행이라 라벨에서 빈 공간으로 마우스 옮기면 `pointerleave`(범례 밖일 때만) 안 떠서 `--active` 볼드가 남고 `:hover` 밑줄만 풀리던 버그 → 범례 `pointerover` 가 아이템 아닌 곳(bare container) 보고하면 clear(=`:hover` 와 일치). strip 은 1px gap 이라 gap-clear 하면 sweep 시 깜빡여서 "세그먼트 위에서만 set + pointerleave clear"(기존) 유지. **리팩터**: 두 섹션 캐시/inflight 로직을 모듈 `createCachedFetcher<T>` 로 DRY(T-26 함수 길이 cap 해결). + **다크모드 마감**: preview 팝오버는 `document.body` 에 붙어 `DASHBOARD_CONTAINERS` 테마 적용 밖이라 다크에서 light fallback 으로 렌더됐음 → `show()` 마다 `syncPopoverTheme(el)` 이 `resolveEffectiveDashboardTheme(getDarkMode())` 로 판정해 `data-di-theme="dark"` 직접 세팅(sync-settings 팝오버 패턴). 감사 결과 activity/section-A CSS 는 전부 `var(--di-*)`/모드무관, suspicious 근검정(#1b1f24)은 `.di-activity-seg--flag` 빨간 inset 으로 다크 가시성 OK — 테마 attr 만이 유일한 문제였음. ⚠️ 활동 피드 search param·ts·`is_new` split·`id:` comma·`comments.json` group_by·**인덱스 페이지 URL**·**suspicious id: link-out URL** 은 샌드박스 차단으로 **라이브 미검증** — 실제 페이지 확인 필요. **모바일 계층 3개 완료(위 참조). **다음: 다크모드 마감 + v9.7.0 머지.**

## 메모
- `CONFIG.THEMES` 에 테마 추가 시 light/dark 섹션 코멘트 유지 (현재 12 개 테마 — Light 6: Light/Solarized Light/Sakura/Lavender/Ice/Aurora, Dark 6: Midnight/Solarized Dark/Dracula/Ocean/Monokai/Ember)
- `getBestThumbnailUrl()` 우선순위: 720x720 webp > 360x360 webp > 기타 변형 > preview > file
- `mapConcurrent()` 유틸은 병렬 API 호출 제어용 (count fetch, tag filtering 에서 사용)
- `MAX_OPTIMIZED_POSTS = 1200` — Quick Sync / Small Tag 경로의 분기 임계값 ([src/config.ts](src/config.ts))
- Count cache TTL (v9.6): `getCountCacheTtlMs()` 기본 10 분, 사용자가 settings popover 에서 조절 가능. `tryGetCachedStats<T>` 가 일관 사용
