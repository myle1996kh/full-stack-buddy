/**
 * Delivery Label Evaluator — standalone (no reference needed)
 *
 * Evaluates a single SoundPatternV2 and returns a human-readable
 * confidence/emotion label with scores and Vietnamese feedback.
 *
 * Labels: 'confident' | 'neutral' | 'hesitant' | 'unsure' | 'anxious'
 * Scores: confidenceScore, hesitationScore, anxietyScore, fluencyScore (0–100 each)
 */

import type {
    AdvancedSoundAnalysis,
    AdvancedLabelSummary,
    DeliveryStateLabel,
    SoundPatternV2,
} from './types';
import { extractAdvancedSoundAnalysis } from './advancedAnalysis';

// ── Result type ──

export interface DeliveryLabelResult {
    /** Primary label: best-fit delivery state */
    label: DeliveryStateLabel;
    /** Softmax-like probability distribution across all 5 labels */
    labelProbabilities: Record<DeliveryStateLabel, number>;
    /** 0–100: how confident the delivery sounds */
    confidenceScore: number;
    /** 0–100: hesitation signals (pauses, elongations, rising endings) */
    hesitationScore: number;
    /** 0–100: anxiety signals (fast rate, pitch variability, irregular rhythm) */
    anxietyScore: number;
    /** 0–100: inverse of stuttering / pause / irregularity penalties */
    fluencyScore: number;
    /** Acoustic evidence list (English short phrases) */
    evidence: string[];
    /** Human-readable Vietnamese feedback messages */
    feedback: string[];
    /** Raw acoustic signals for debugging / display */
    debug: {
        pauseTotal: number;
        pauseLong: number;
        pauseTotalSec: number;
        elongationCount: number;
        elongationHesitant: number;
        finalMovement: string;
        initialMovement: string;
        pitchRangeSt: number;
        contourStability: number;
        speechRate: number;
        articulationRate: number;
        regularity: number;
        tempoVariability: number;
    };
}

// ── Main API ──

/**
 * Evaluate the delivery state of a single recording.
 * Uses `pattern.advanced` if already computed; extracts on the fly otherwise.
 */
export function evaluateDeliveryLabel(pattern: SoundPatternV2): DeliveryLabelResult {
    const adv: AdvancedSoundAnalysis = pattern.advanced ?? extractAdvancedSoundAnalysis(pattern);
    const { summary, pauses, elongation, intonation, rhythm } = adv;

    const feedback = buildDeliveryFeedback(summary, pauses, elongation, intonation, rhythm);

    return {
        label: summary.label,
        labelProbabilities: summary.labelProbabilities,
        confidenceScore: summary.confidenceScore,
        hesitationScore: summary.hesitationScore,
        anxietyScore: summary.anxietyScore,
        fluencyScore: summary.fluencyScore,
        evidence: summary.evidence,
        feedback,
        debug: {
            pauseTotal: pauses.total,
            pauseLong: pauses.long,
            pauseTotalSec: pauses.totalDurationSec,
            elongationCount: elongation.count,
            elongationHesitant: elongation.events.filter(e => e.kind === 'hesitation_lengthening').length,
            finalMovement: intonation.finalMovement,
            initialMovement: intonation.initialMovement,
            pitchRangeSt: intonation.pitchRangeSt,
            contourStability: intonation.contourStability,
            speechRate: rhythm.speechRate,
            articulationRate: rhythm.articulationRate,
            regularity: rhythm.regularity,
            tempoVariability: rhythm.tempoVariability,
        },
    };
}

// ── Feedback builder ──

const LABEL_HEADLINE: Record<DeliveryStateLabel, string> = {
    confident: 'Giọng phát hiện: tự tin, rõ ràng.',
    neutral:   'Giọng phát hiện: trung tính, bình thường.',
    hesitant:  'Giọng phát hiện: lưỡng lự / ngập ngừng.',
    unsure:    'Giọng phát hiện: không chắc chắn.',
    anxious:   'Giọng phát hiện: lo lắng / căng thẳng.',
};

function buildDeliveryFeedback(
    summary: AdvancedLabelSummary,
    pauses: AdvancedSoundAnalysis['pauses'],
    elongation: AdvancedSoundAnalysis['elongation'],
    intonation: AdvancedSoundAnalysis['intonation'],
    rhythm: AdvancedSoundAnalysis['rhythm'],
): string[] {
    const fb: string[] = [];
    const { label, confidenceScore, hesitationScore, anxietyScore, fluencyScore } = summary;

    // 1. Overall label headline
    fb.push(LABEL_HEADLINE[label]);

    // 2. Hesitation signals
    if (hesitationScore >= 55) {
        if (pauses.long > 0) {
            fb.push(`Có ${pauses.long} khoảng lặng dài (≥0.6s) — dấu hiệu ngập ngừng rõ.`);
        } else if (pauses.medium > 0) {
            fb.push(`Có ${pauses.medium} khoảng lặng vừa (0.3–0.6s) — nhịp nói bị gián đoạn.`);
        }
        const hesitantElong = elongation.events.filter(e => e.kind === 'hesitation_lengthening').length;
        if (hesitantElong > 0) {
            fb.push(`Phát hiện ${hesitantElong} lần kéo dài âm trước khoảng lặng — dấu hiệu do dự.`);
        }
    } else if (hesitationScore >= 35 && pauses.total > 0) {
        fb.push(`${pauses.total} khoảng ngừng nhỏ — nói chấp nhận được nhưng có thể trơn tru hơn.`);
    }

    // 3. Anxiety signals
    if (anxietyScore >= 50) {
        if (rhythm.speechRate > 4.8) {
            fb.push(`Tốc độ nói nhanh (${rhythm.speechRate.toFixed(1)} onset/s) — có thể do căng thẳng.`);
        }
        if (rhythm.tempoVariability > 0.7) {
            fb.push('Nhịp nói không đều, tốc độ dao động mạnh — thiếu kiểm soát hơi thở.');
        }
        if (intonation.pitchRangeSt > 6) {
            fb.push('Cao độ biến thiên nhiều — giọng nghe có vẻ căng / hồi hộp.');
        }
    }

    // 4. Fluency
    if (fluencyScore >= 80) {
        fb.push(`Độ lưu loát: ${fluencyScore}/100 — nói mạch lạc, ít bị gián đoạn.`);
    } else if (fluencyScore >= 55) {
        fb.push(`Độ lưu loát: ${fluencyScore}/100 — ổn, nhưng còn một số chỗ gián đoạn.`);
    } else {
        fb.push(`Độ lưu loát: ${fluencyScore}/100 — cần luyện nói liên tục, giảm ngừng giữa câu.`);
    }

    // 5. Intonation
    if (intonation.finalMovement === 'rise') {
        fb.push('Cuối câu lên giọng — nghe chưa dứt khoát, dễ bị hiểu là đặt câu hỏi.');
    }
    if (intonation.pitchRangeSt < 2.5) {
        fb.push('Cao độ ít biến thiên — giọng hơi đơn điệu, thiếu sắc thái cảm xúc.');
    } else if (label === 'confident' && intonation.contourStability >= 0.65) {
        fb.push('Đường pitch ổn định, có nhấn nhá phù hợp — biểu cảm tốt.');
    }

    // 6. Confidence score summary
    if (confidenceScore >= 70) {
        fb.push(`Chỉ số tự tin: ${confidenceScore}/100 ✓`);
    } else if (confidenceScore >= 45) {
        fb.push(`Chỉ số tự tin: ${confidenceScore}/100 — ở mức trung bình.`);
    } else {
        fb.push(`Chỉ số tự tin: ${confidenceScore}/100 — cần cải thiện.`);
    }

    return fb;
}
