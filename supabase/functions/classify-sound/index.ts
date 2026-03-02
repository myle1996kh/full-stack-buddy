import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SpectralSnapshot {
  centroid: number;
  zcr: number;
  rolloff: number;
  energy: number;
  lowBandRatio: number;
  midBandRatio: number;
  highBandRatio: number;
  volume: number;
  pitch: number;
  isOnset: boolean;
  heuristicLabel: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { snapshots } = (await req.json()) as { snapshots: SpectralSnapshot[] };

    if (!snapshots || snapshots.length === 0) {
      return new Response(JSON.stringify({ labels: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Summarize snapshots into a compact text representation for the AI
    const summary = snapshots.map((s, i) => {
      const parts = [
        `#${i}`,
        `vol=${s.volume.toFixed(0)}`,
        `pitch=${s.pitch}Hz`,
        `centroid=${s.centroid}Hz`,
        `zcr=${s.zcr.toFixed(3)}`,
        `rolloff=${s.rolloff}Hz`,
        `low=${s.lowBandRatio.toFixed(2)}`,
        `mid=${s.midBandRatio.toFixed(2)}`,
        `high=${s.highBandRatio.toFixed(2)}`,
        `onset=${s.isOnset}`,
        `hint=${s.heuristicLabel}`,
      ];
      return parts.join(" ");
    }).join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an audio event classifier. Given spectral feature snapshots from a microphone, classify each snapshot into one of these labels:
- silence: no meaningful sound
- voice: human speech or singing
- clap: hand clap sound
- snap: finger snap
- slap: thigh slap or body percussion
- stomp: foot stomp, heavy low-frequency impact
- percussion: generic percussive sound that doesn't fit above
- unknown: sound detected but unclassifiable

Key classification rules:
- High ZCR (>0.3) + high centroid (>2000Hz) + onset = likely clap
- Very high centroid (>3000Hz) + high band dominant + onset = likely snap
- Low centroid (<800Hz) + high low-band ratio + onset = stomp/slap
- Pitch 80-500Hz + moderate ZCR + mid-band dominant = voice
- Volume <3 = silence

Respond with ONLY a JSON array of labels in the same order as inputs. Example: ["voice","clap","silence"]
No explanation, just the JSON array.`,
          },
          {
            role: "user",
            content: `Classify these ${snapshots.length} audio snapshots:\n${summary}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content ?? "[]";

    // Parse the AI response - it should be a JSON array
    let labels: string[];
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      labels = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      // Fallback to heuristic labels
      labels = snapshots.map((s) => s.heuristicLabel);
    }

    return new Response(JSON.stringify({ labels }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-sound error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
