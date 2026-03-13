# Vocal Scorer — Scoring Specification
> Tài liệu này mô tả **đúng cách hệ thống chấm điểm**, đủ để developer tái tạo kết quả khớp với coach manual.

---

## Tổng quan kiến trúc

Hệ thống là **hybrid**: librosa trích xuất số liệu thô, LLM chấm điểm dựa trên rubric.

```
audio files
    ↓
[librosa] → raw acoustic features (JSON)
    ↓
[LLM + rubric below] → Tempo score, Energy score, Overall score
    ↓
JSON output
```

Lý do dùng LLM thay vì rule-based thuần túy:
- Energy score phụ thuộc vào **pattern + direction** (louder vs softer), không chỉ số học
- Coach judgment tích hợp nhiều tín hiệu ngầm (flatness, consistency)
- LLM tái tạo scoring gần đúng hơn bất kỳ công thức nào

---

## Step 1 — Trích xuất features bằng librosa

```python
import librosa, numpy as np

def extract_features(path):
    y, sr = librosa.load(path, sr=None)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    rms = librosa.feature.rms(y=y)[0]
    intervals = librosa.effects.split(y, top_db=30)
    return {
        "duration":    round(librosa.get_duration(y=y, sr=sr), 2),
        "tempo_bpm":   round(float(np.atleast_1d(tempo)[0]), 1),
        "avg_rms":     round(float(np.mean(rms)), 5),
        "max_rms":     round(float(np.max(rms)), 5),
        "n_segments":  len(intervals),
    }
```

**Output cần thiết cho scoring** (5 fields):

| Field | Ý nghĩa |
|---|---|
| `tempo_bpm` | BPM tổng thể |
| `avg_rms` | Năng lượng trung bình |
| `max_rms` | Năng lượng đỉnh |
| `duration` | Độ dài (giây) |
| `n_segments` | Số speech chunk (nhóm âm) |

---

## Step 2 — LLM Scoring Prompt

Gọi LLM với prompt sau. Thay `{REF_DATA}` và `{CAND_DATA}` bằng JSON features từ Step 1.

```
SYSTEM:
Bạn là vocal coach chuyên nghiệp. Nhiệm vụ: chấm điểm giọng học viên so với mẫu gốc.
Chỉ trả về JSON, không giải thích thêm.

USER:
Dữ liệu acoustic (trích xuất bằng librosa):

REFERENCE (mẫu gốc):
{REF_DATA}

CANDIDATE (học viên):
{CAND_DATA}

Chấm điểm theo RUBRIC sau:

=== TEMPO SCORE (0-100) ===
Tính: bpm_diff_pct = |cand_bpm - ref_bpm| / ref_bpm × 100

Thang điểm:
- diff ≤ 1%:           97   (khớp hoàn hảo)
- diff 1–5%:           95   (gần như khớp)
- diff 5–10%:          88
- diff 10–20%:         75
- diff 20–35%:         62
- diff 35–50%:         48
- diff 50–70%:         33
- diff 70–90%:         22
- diff > 90%:          20   (gấp đôi hoặc hơn)

Bonus/penalty nhỏ dựa trên duration:
- Nếu duration lệch < 10%: không điều chỉnh
- Nếu duration lệch > 50%: trừ thêm 5–10 điểm

=== ENERGY SCORE (0-100) ===
Tính: diff_pct = |cand_avg_rms - ref_avg_rms| / ref_avg_rms × 100
Xác định direction: LOUDER nếu cand > ref, SOFTER nếu cand < ref

LOUDER (cand_rms > ref_rms):
- Penalty nặng hơn vì đẩy lực quá mức
- diff 0–5%:   82–90
- diff 5–15%:  70–82
- diff 15–30%: 55–70
- diff > 30%:  < 55

SOFTER (cand_rms < ref_rms):
- Penalty nhẹ hơn ở mức trung bình, nặng hơn khi cực thấp
- diff 0–5%:   85–92
- diff 5–15%:  82–88  ← softer nhưng gần = ít bị trừ
- diff 15–40%: 50–75
- diff 40–70%: 25–45
- diff > 70%:  < 15   (giọng gần như không nghe thấy)

Điều chỉnh thêm:
- Nếu max_rms cũng thấp tương đương avg_rms: trừ thêm (không có điểm nhấn)
- Nếu pattern tương đồng (max/avg ratio gần bằng ref): cộng thêm 2–5 điểm

=== OVERALL SCORE ===
Công thức cơ bản: base = tempo × 0.5 + energy × 0.5

Điều chỉnh:
1. Nếu energy < 20: overall = min(base, energy × 2.5)
   → Giọng quá nhỏ kéo tổng xuống mạnh
2. Nếu tempo < energy × 0.6: overall = max(base, energy × 1.05)
   → Khi tempo yếu hơn nhiều, energy làm sàn
3. Còn lại: overall = base

Grade: S≥90, A≥80, B≥70, C≥55, D≥40, F<40

=== OUTPUT FORMAT ===
Trả về JSON:
{
  "tempo": {
    "score": <0-100>,
    "bpm_diff_pct": <số>,
    "reasoning": "<giải thích ngắn>"
  },
  "energy": {
    "score": <0-100>,
    "diff_pct": <số>,
    "direction": "louder|softer",
    "reasoning": "<giải thích ngắn>"
  },
  "overall": {
    "score": <0-100>,
    "grade": "<S/A/B/C/D/F>",
    "rule_applied": "<average|energy_cap|energy_floor>",
    "summary": "<1 câu nhận xét>"
  }
}
```

---

## Step 3 — Validation: Ground Truth

Dùng bộ data sau để kiểm tra LLM có chấm đúng không.

**Reference: Vn01.mp3**
```json
{
  "tempo_bpm": 103.4,
  "avg_rms":   0.0543,
  "max_rms":   0.2452,
  "duration":  2.38,
  "n_segments": 7
}
```

**Candidates và expected scores:**

| File | tempo_bpm | avg_rms | max_rms | dur | segs | T target | E target | Overall |
|---|---|---|---|---|---|---|---|---|
| En01 | 103.4 | 0.0569 | 0.2785 | 2.43 | 5 | **95** | **82** | **88** |
| sound01 | 143.6 | 0.0486 | 0.1938 | 2.53 | 9 | **58** | **84** | **72** |
| T-01 | 206.7 | 0.0186 | 0.0955 | 3.55 | 8 | **20** | **35** | **38** |
| T-02 | 105.5 | 0.0097 | 0.0611 | 5.07 | 13 | **97** | **8** | **22** |

**Tolerance:** ±5 điểm là acceptable. Nếu LLM lệch > 5 điểm, xem lại prompt hoặc add few-shot examples.

---

## Step 4 — Few-Shot Examples (thêm vào prompt nếu LLM lệch)

Thêm section này vào cuối USER prompt:

```
EXAMPLES (học từ đây để calibrate):

Example 1 — En01:
  bpm_diff=0.0%, avg_rms louder 4.8%, max_rms higher, duration gần bằng
  → Tempo=95 (khớp hoàn hảo, không penalty), Energy=82 (louder nhẹ bị trừ nhiều hơn softer)
  → Overall=88 (base=88.5, plain average)

Example 2 — sound01:
  bpm_diff=38.9%, avg_rms softer 10.5%, max/avg ratio tương đồng ref (pattern OK)
  → Tempo=58 (lệch gần 40%), Energy=84 (softer nhẹ + pattern tương đồng = ít penalty)
  → Overall=72 (base=71, round up nhẹ vì pattern bonus)

Example 3 — T-01:
  bpm_diff=99.9% (gấp đôi), avg_rms softer 65.7%, max_rms cũng rất thấp
  → Tempo=20 (gấp đôi = worst tier), Energy=35 (softer nặng + max thấp = thêm penalty)
  → Overall=38 (base=27.5, energy floor=36.75 vì tempo << energy×0.6)

Example 4 — T-02:
  bpm_diff=2.0% (gần khớp), avg_rms softer 82.1%, max_rms rất thấp, FLAT
  → Tempo=97 (gần khớp hoàn hảo), Energy=8 (softer cực nặng + flat = minimum)
  → Overall=22 (energy_cap: min(52.5, 8×2.5=20) = 20)
```

---

## Step 5 — Code tích hợp hoàn chỉnh

```python
import json
import librosa
import numpy as np
import anthropic

RUBRIC = """... (paste nội dung rubric từ Step 2) ..."""
FEW_SHOT = """... (paste examples từ Step 4) ..."""

def extract_features(path):
    y, sr = librosa.load(path, sr=None)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    rms = librosa.feature.rms(y=y)[0]
    intervals = librosa.effects.split(y, top_db=30)
    return {
        "duration":   round(librosa.get_duration(y=y, sr=sr), 2),
        "tempo_bpm":  round(float(np.atleast_1d(tempo)[0]), 1),
        "avg_rms":    round(float(np.mean(rms)), 5),
        "max_rms":    round(float(np.max(rms)), 5),
        "n_segments": len(intervals),
    }

def score(reference_path, candidate_path, include_few_shot=True):
    ref  = extract_features(reference_path)
    cand = extract_features(candidate_path)

    prompt = f"""
Dữ liệu acoustic:

REFERENCE: {json.dumps(ref)}
CANDIDATE: {json.dumps(cand)}

{RUBRIC}
{FEW_SHOT if include_few_shot else ""}
"""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        system="Bạn là vocal coach. Chỉ trả về JSON, không text thêm.",
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    # Strip markdown fences
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.split("```")[0]

    return json.loads(raw.strip())


# Usage:
if __name__ == "__main__":
    result = score("Vn01.mp3", "En01.mp3")
    print(json.dumps(result, ensure_ascii=False, indent=2))
```

---

## Tóm tắt logic chấm điểm

```
TEMPO:  tiered by BPM diff% (xem bảng rubric)
        ± adjustment nhỏ nếu duration lệch > 50%

ENERGY: direction-aware
        LOUDER → penalty nặng hơn
        SOFTER → penalty nhẹ ở mid-range, nặng ở extreme
        Bonus nếu max/avg pattern tương đồng ref
        Penalty thêm nếu max_rms cũng thấp (flat/whisper)

OVERALL: base = T×0.5 + E×0.5
         energy_cap   nếu E < 20 → min(base, E×2.5)
         energy_floor nếu T < E×0.6 → max(base, E×1.05)
```

---

*File này là ground truth để calibrate LLM. Tolerance ±5 điểm.*
