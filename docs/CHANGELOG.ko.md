# 검토·개선 내역 — v4.0.0 / 2026-09-10

입력: `index(20260910-012919).html`, v3.0.0, 224개 항목.
결과: 외부 런타임 의존성이 없는 단일 HTML 실행본, 수정 가능한 분리 소스, 233개 항목, 6개 학습·연구 경로.

## 원본 평가

교재·강의·최적화 논문·딥러닝 옵티마이저·학습이론·기반 수학·조합최적화·도구·연구 워크플로까지 범위가 넓고, 자료 검색과 개인 기록 관리의 기본 기능이 이미 갖추어져 있었습니다. 우선적으로 보완할 부분은 서지정보 정확성, 저장·복원 안정성, 검색 구문의 경계 사례, 키보드 접근성, 첫 화면의 정보 밀도였습니다.

## 실제 재현 후 수정한 문제

| 문제 | 수정 |
| --- | --- |
| `author:"Stephen Boyd"`, 부정 구문, 따옴표 속 OR 분리 오류 | 따옴표 상태를 추적하는 단일 패스 파서 |
| 검색 하이라이트가 HTML 엔티티와 자기 자신의 `<mark>`를 다시 치환 | 원문을 한 번만 매칭하고 조각별 HTML 이스케이프 |
| 손상된 localStorage 컬렉션으로 초기화 중단 | 형식·ID·읽기 상태를 검증한 뒤 초기화 |
| 공유 URL에 없는 필터가 수신자의 이전 설정에서 상속 | 공유 필터를 기본 상태에서 재구성 |
| 노트 입력 직후 닫으면 저장 누락 | 입력 이벤트에서 즉시 기록, 닫기 시 저장 |
| 저장 용량 초과 후 메모리 값 대신 과거 값 읽기 | 세션 메모리의 최신 값을 우선하고 저장 제한 표시 |
| CSV 수식 접두어·CR 처리 미흡 | 공백 뒤 수식 접두어 보호, CR/LF/따옴표 인용 |
| BibTeX 저자 구분 오류·인용 키 충돌 | 저자 `and`, 고유 자료 ID 키, TeX 특수문자 처리 |
| 개인 기록 삭제 후 v2 기록 재등장 | 이전 키와 현재 키를 함께 처리 |
| 합치기 복원 시 중복 선택 때문에 빈 비교 슬롯 발생 | 중복 제거 후 최대 4개 제한 |

추가로 백업 스키마·버전·파일 크기를 검증하고 기본 복원 방식을 합치기로 바꾸었습니다. 개인 노트와 읽기 상태 충돌은 현재 기록을 유지하며 교체는 명시적으로 선택합니다. 검색 입력 지연으로 생길 수 있는 덮어쓰기와 한국어 IME 조합도 처리했습니다.

## 사용성·접근성·구조

- 큰 소개 영역을 줄이고 검색·필터·자료 결과를 앞에 배치했습니다.
- 기존 짙은 남색·청록색 시각 방향을 유지하고 라이트 모드의 강조색 대비를 조정했습니다.
- 작은 화면의 분야·경로 탐색은 접고 펼칠 수 있습니다.
- 검색·노트·상태에 명시적 레이블, 결과 수 알림, 선택 상태, 표 머리글을 적용했습니다.
- 다시 렌더링되는 버튼의 포커스를 자료 ID로 복원합니다. 대화상자 뒤 배경에는 `inert`를 적용하고 단축키의 범위를 제한합니다.
- 표 보기에도 즐겨찾기와 비교 선택을 제공합니다.
- CSV에 자료 ID와 개인 노트를 별도 열로 추가했습니다.
- 로컬 HTML 사이에는 필터 코드를 복사·불러올 수 있습니다.
- HTML 템플릿, CSS, JS, 자료 JSON, 경로 JSON, 빌드 도구와 테스트를 분리했습니다.

## 자료 수정

23개 기존 항목을 원출처와 대조하여 수정했습니다. 전체 수정값, 사유, 근거 URL은 `reference-audit.json`에 기록되어 있습니다. 일부 중요한 사례:

| 자료 | 수정 내용·근거 |
| --- | --- |
| FISTA | 무관한 arXiv 논문 링크를 [논문 DOI](https://doi.org/10.1137/080716542)와 논문 PDF로 교체 |
| ADMM | 다른 논문 링크를 [Boyd의 논문 페이지](https://web.stanford.edu/~boyd/papers/admm_distr_stats.html)로 교체 |
| Revisiting Frank–Wolfe | [PMLR 원문](https://proceedings.mlr.press/v28/jaggi13.html)으로 연결 수정 |
| Jain–Kar, Non-convex Optimization for Machine Learning | [arXiv 1712.07897](https://arxiv.org/abs/1712.07897)로 수정 |
| Large-Scale Convex Optimization | Ernest K. Ryu·Wotao Yin 저자 정보와 [공식 교재 페이지](https://large-scale-book.mathopt.com/) 수정 |
| Linear Algebra Done Right | [무료 공개 4판](https://linear.axler.net/)으로 갱신 |
| Schrijver, Combinatorial Optimization: Polyhedra and Efficiency | 다른 책·강의로 연결되던 링크를 [저자 교재 페이지](https://homepages.cwi.nl/~lex/co/)로 수정 |

SPIDER·ASAM·Sophia·PAC-Bayes 등의 저자 정보와 일부 실제 논문 제목도 바로잡았습니다. 상시 갱신되는 도구 문서의 근거 없는 2026 발행연도는 비워 두고 별도 설명을 기록했습니다. 발행·프리프린트 연도가 서로 다른 논문은 일괄 변경하지 않았습니다.

## 추가 자료 9개

1. Which Algorithmic Choices Matter at Which Batch Sizes? Insights From a Noisy Quadratic Model
2. An Investigation into Neural Net Optimization via Hessian Eigenvalue Density
3. Fast Estimation of tr(f(A)) via Stochastic Lanczos Quadrature
4. New Insights and Perspectives on the Natural Gradient Method
5. Stochastic Gradient Descent as Approximate Bayesian Inference
6. Gradient Descent on Neural Networks Typically Occurs at the Edge of Stability
7. The Bayesian Learning Rule
8. Efficient and Modular Implicit Differentiation
9. PyHessian: Neural Networks Through the Lens of the Hessian

기초 목록을 유지하면서 이차모형, 곡률·잡음 공분산, 자연경사, Bayesian 해석, 수치 스펙트럼 추정으로 연결되는 연구 자료를 보충했습니다. 각 자료의 가정이 실제 신경망에 항상 성립한다고 주장하지 않습니다.

## 검증과 한계

Node 내장 테스트 17개로 검색·저장·복원·인용·렌더링 문자열을 검사했습니다. Python 빌드 검사로 ID 유일성, 경로 참조, DOM ID 참조, 허용 URL 형식, 외부 런타임 파일 부재, 생성본 일치를 검사했습니다. 최초 10개 테스트는 원본 코드에서 모두 실패하고 수정본에서 통과하는 것을 확인했습니다. 복원 선택 중복 문제도 별도 실패 사례로 재현한 뒤 수정했습니다.

실제 브라우저의 시각적 QA와 모든 외부 링크의 실시간 접속 검증은 수행하지 않았습니다. 정적 CSS와 UI 구조를 검토했으며 자동 테스트에는 DOM 대역을 사용했습니다. 개별 자료의 `verifiedFields`는 이번에 대조한 필드의 범위입니다. 원본의 다른 필드를 모두 검증했다는 의미는 아닙니다.

같은 문헌의 여러 분야별 등록과 기존 ID를 유지하여, 이전 개인 기록을 덮어쓰거나 합치는 데 따른 유실을 피했습니다. 따라서 233은 고유 문헌 수가 아닌 항목 수입니다. 난이도·우선순위·학습 경로는 학습용 편집 판단입니다.
