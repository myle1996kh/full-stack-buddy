/**
 * Multimodal Audio Analysis using Gemini REST API (no SDK needed)
 * Compares audio files against a reference for style imitation assessment.
 */
import fs from "fs";
import path from "path";

const API_KEY = "AIzaSyAzxmtvLmRC40PRNK4JldhHvgtmPhy9GXc";
const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

const TEST_DIR = "C:\\Users\\gensh\\Downloads\\test";

async function analyzeAudioPair(refPath, attemptPath, refName, attemptName) {
    const refBase64 = fs.readFileSync(refPath).toString("base64");
    const attemptBase64 = fs.readFileSync(attemptPath).toString("base64");

    const prompt = `Bạn là chuyên gia vocal coach và speech analysis chuyên nghiệp.

Tôi gửi cho bạn 2 đoạn audio:
- **Audio 1 (Reference - ${refName})**: Đoạn mẫu gốc
- **Audio 2 (Attempt - ${attemptName})**: Đoạn cần so sánh

Hãy phân tích CHI TIẾT:

1. **Nội dung**: Mỗi audio nói gì? Ngôn ngữ gì?
2. **Delivery Pattern (Cách phát âm)**: 
   - Elongation: Có kéo dài từ nào? Giống nhau không?
   - Emphasis: Nhấn mạnh ở đâu?
3. **Rhythm & Pace**: Tốc độ và nhịp điệu
4. **Energy/Intensity**: Mạnh/yếu qua từng đoạn
5. **Expressiveness**: Biểu cảm, cảm xúc giọng 
6. **Overall Style Match**: Đánh giá tổng thể

Cho điểm MỖI khía cạnh trên thang 0-100 và điểm TỔNG.
Giải thích ngắn gọn tại sao cho điểm như vậy.`;

    const requestBody = {
        contents: [
            {
                parts: [
                    {
                        inline_data: {
                            mime_type: "audio/mpeg",
                            data: refBase64,
                        },
                    },
                    {
                        inline_data: {
                            mime_type: "audio/mpeg",
                            data: attemptBase64,
                        },
                    },
                    { text: prompt },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
        },
    };

    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response";
}

async function main() {
    const refPath = path.join(TEST_DIR, "Vn01.mp3");
    const attempts = ["En01.mp3", "T-01.mp3", "T-02.mp3", "sound01.mp3"];

    console.log("=".repeat(80));
    console.log("  MULTIMODAL LLM AUDIO STYLE ANALYSIS");
    console.log("  Reference: Vn01.mp3");
    console.log(`  Model: ${MODEL}`);
    console.log("=".repeat(80));

    const results = {};

    for (const attempt of attempts) {
        const attemptPath = path.join(TEST_DIR, attempt);
        if (!fs.existsSync(attemptPath)) {
            console.log(`\nSkipping ${attempt} (not found)`);
            continue;
        }

        console.log(`\n${"─".repeat(80)}`);
        console.log(`  📊 Analyzing: Vn01.mp3 (ref) vs ${attempt}`);
        console.log(`${"─".repeat(80)}\n`);

        try {
            const result = await analyzeAudioPair(refPath, attemptPath, "Vn01.mp3", attempt);
            console.log(result);
            results[attempt] = result;
        } catch (err) {
            console.error(`Error: ${err.message}`);
            results[attempt] = `Error: ${err.message}`;
        }
    }

    // Save results to file
    const outputPath = path.join(TEST_DIR, "analysis_results.md");
    let md = `# Audio Style Analysis Results\n\n`;
    md += `**Reference:** Vn01.mp3\n`;
    md += `**Model:** ${MODEL}\n`;
    md += `**Date:** ${new Date().toISOString()}\n\n`;

    for (const [file, result] of Object.entries(results)) {
        md += `---\n\n## Vn01.mp3 vs ${file}\n\n${result}\n\n`;
    }

    fs.writeFileSync(outputPath, md, "utf-8");
    console.log(`\n\nResults saved to: ${outputPath}`);
}

main().catch(console.error);
