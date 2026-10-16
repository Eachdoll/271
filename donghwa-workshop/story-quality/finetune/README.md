# 로컬 LoRA 레시피 (Mac Studio, MLX)

증류 데이터(승인 샘플 300~400편 + 골드 24편)로 소형 모델에 '동화공방 줄거리 형식'을 입힌다. 과제가 좁아서(같은 프롬프트 형식, JSON 출력, 7비트 구조) 8B급 모델도 튜닝 뒤엔 줄거리 품질이 상위 API 모델에 근접하고, 그다음부터는 비용이 0이다.

## 0. 왜 로컬인가
- OpenAI 파인튜닝 플랫폼은 신규 사용자 종료 중(2026-10 기준 문서 명시). 지원 모델도 gpt-4.1 계열뿐.
- Anthropic은 일반 파인튜닝을 제공하지 않는다.
- Google Vertex AI의 Gemini supervised tuning은 가능하나 GCP 설정·과금이 따로 든다(필요하면 문서 확인).
- Mac Studio(M5 Ultra 256GB)면 8B~14B LoRA는 몇십 분, 32B도 가능하다.

## 1. 데이터 만들기

```bash
# 증류(상위 모델, 1회) — 400편 기준 Sonnet 5.5 약 $6, Opus 5.5 약 $12 (배치 API면 절반)
ANTHROPIC_API_KEY=... npm run distill -- --gen anthropic:claude-sonnet-5-5 --judge anthropic:claude-haiku-5-5 --variants 4
# 또는 Opus로 품질 우선
ANTHROPIC_API_KEY=... npm run distill -- --gen anthropic:claude-opus-5-5 --variants 4

# 학습 포맷 변환 (승인 샘플 + 골드 24 → train/valid/test.jsonl, 주제 단위 분할)
npm run finetune:data -- --format mlx --out finetune/data
```

`finetune/data/stats.json`에서 패턴·시대별 분포를 확인한다. 한 패턴이 15% 미만이면 그 패턴 주제를 `distill/topics.json`에 더 넣고 증류를 이어 돌린다(재개 가능).

## 2. 모델 선택 (한국어 가능한 오픈 웨이트)
후보를 MLX 커뮤니티 변환본(`mlx-community/...`)으로 받는다. 8B 전후로 시작해 평가 하네스로 비교한 뒤 키운다.

| 후보 | 크기 | 비고 |
| --- | --- | --- |
| Qwen3 8B / 14B | 8B·14B | 한국어 양호, MLX 변환본 많음. 1순위 |
| EXAONE 4.0 계열 | 7.8B·32B | 한국어 최상, 라이선스는 비상업(가정용 OK) |
| Gemma 3 12B | 12B | 한국어 양호 |

정확한 저장소 이름은 Hugging Face에서 `mlx-community` + 모델명으로 검색해 4bit 양자화본(`-4bit`)을 고른다(QLoRA, 메모리 절약).

## 3. 학습

```bash
pip install "mlx-lm[train]"

mlx_lm.lora \
  --model mlx-community/<모델>-4bit \
  --train \
  --data finetune/data \
  --iters 800 \
  --batch-size 2 \
  --grad-accumulation-steps 4 \
  --num-layers 16 \
  --learning-rate 1e-5 \
  --mask-prompt \
  --grad-checkpoint \
  --adapter-path finetune/adapters/<run-name>
```

- `--mask-prompt`: 마지막 assistant 메시지(정답 JSON)만 학습. 프롬프트를 외우지 않게 한다. 필수.
- `--data`에는 `train.jsonl`(필수)·`valid.jsonl`(있으면 검증 손실 보고)·`test.jsonl`(`--test`용)이 있어야 한다. 변환기가 셋 다 만든다.
- 시퀀스 길이: 프롬프트 약 1,800토큰 + 정답 약 1,500토큰 → `--max-seq-length 4096`이 필요하면 추가.
- 메모리가 모자라면 `--batch-size 1`, `--num-layers 8`. 256GB면 14B 4bit에 batch 4도 된다.
- iters는 (예시 수 × 3 epoch) / (batch × grad-accum) 근처. 400예시면 600~900.
- 검증 손실이 오르기 시작하면 멈춘다(과적합). `--save-every 100`으로 중간 어댑터를 남긴다.

YAML로 두고 싶으면 `mlx_lm.lora -c finetune/lora.yaml` (아래 예시).

```yaml
model: mlx-community/<모델>-4bit
train: true
data: finetune/data
iters: 800
batch_size: 2
grad_accumulation_steps: 4
num_layers: 16
learning_rate: 1e-5
mask_prompt: true
grad_checkpoint: true
adapter_path: finetune/adapters/run1
save_every: 100
```

## 4. 평가 (학습 전후 같은 20주제)

```bash
# 어댑터를 붙인 로컬 서버 띄우기 (OpenAI 호환)
mlx_lm.server --model mlx-community/<모델>-4bit --adapter-path finetune/adapters/run1 --port 8080

# 하네스에 local 엔진으로 연결 (판정은 Haiku 5.5)
ANTHROPIC_API_KEY=... node dist/cli/eval.js run --run-id local-qwen3-8b-lora --gen "local:http://localhost:8080/v1#default" --judge anthropic:claude-haiku-5-5
node dist/cli/eval.js compare --baseline sonnet55-v3
```

기준선 3개를 먼저 만들어 둔다: `haiku55-v3`(튜닝 전 보급형), `sonnet55-v3`, `opus55-v3`. 로컬 LoRA가 `sonnet55-v3`의 루브릭 평균에 0.5 이내로 붙으면 성공. plotCheck 통과율은 코드가 잡아 주므로 70% 이상이면 충분하다(나머지는 수정 패스).

## 5. 배포
```bash
mlx_lm.fuse --model mlx-community/<모델>-4bit --adapter-path finetune/adapters/run1 --save-path finetune/fused/donghwa-outline-v1
mlx_lm.server --model finetune/fused/donghwa-outline-v1 --port 8080
```
앱의 글 엔진 설정에서 `local` 엔진 base URL을 `http://<맥스튜디오>:8080/v1`로 두면, 줄거리 단계가 비용 0으로 돈다. 전문·쪽 나누기는 그대로 보급형 API 또는 같은 로컬 모델(튜닝 없이)로.

## 6. 다음 라운드
- 앱에서 부모가 승인한 책이 50편 쌓일 때마다 `BookRecord` → 증류 JSONL 포맷으로 내보내(`sampleToBookRecord`의 역방향; 승인·루브릭 점수 포함) 학습 데이터에 섞는다. "우리 집에서 통과한 예시"가 가장 센 신호다.
- 유하가 다시 읽어 달라고 한 책·웃은 쪽은 `feedback`에 기록해 두면 다음 증류의 가중치(검색 점수)와 LoRA 데이터 선별에 쓴다.
- 평가 하네스 결과(`eval/results/*.summary.json`)를 버전마다 남겨 두면, 프롬프트 변경·코치 패스 규칙 갱신·모델 교체의 효과를 같은 20주제로 비교할 수 있다.
