import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  // data URL: data:image/jpeg;base64,...
  imageDataUrl: z
    .string()
    .trim()
    .min(50)
    .max(2_500_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,/, "Invalid image data URL"),
});

type Verdict = {
  ok: boolean;
  humanCount: number;
  reason: string;
};

export const checkHumanInFrame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data }): Promise<Verdict> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You inspect a single webcam still and report how many distinct human faces are clearly visible. Respond ONLY by calling the report_humans tool.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Count distinct human faces clearly visible in this webcam frame. A reflection, photo on a wall, or screen-displayed face does NOT count.",
              },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_humans",
              description: "Report how many humans are clearly visible.",
              parameters: {
                type: "object",
                properties: {
                  humanCount: { type: "integer", minimum: 0, maximum: 20 },
                  reason: { type: "string", maxLength: 200 },
                },
                required: ["humanCount", "reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_humans" } },
      }),
    });

    if (res.status === 429) {
      throw new Error("Rate limit reached. Please try again in a moment.");
    }
    if (res.status === 402) {
      throw new Error("AI credits exhausted. Please add credits in workspace settings.");
    }
    if (!res.ok) {
      throw new Error(`Vision check failed (${res.status})`);
    }

    const json = await res.json();
    const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { humanCount: number; reason: string } | null = null;
    try {
      parsed = typeof args === "string" ? JSON.parse(args) : args;
    } catch {
      parsed = null;
    }
    const humanCount = Math.max(0, Math.floor(parsed?.humanCount ?? 0));
    const reason = parsed?.reason ?? "";
    return {
      ok: humanCount === 1,
      humanCount,
      reason:
        reason ||
        (humanCount === 0
          ? "No person detected in front of the camera."
          : humanCount > 1
            ? "More than one person detected."
            : "Looks good."),
    };
  });
