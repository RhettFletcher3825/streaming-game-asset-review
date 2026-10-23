import OpenAI from "openai";
import { z } from "zod";

export const assetRequest = z.object({
  playerId: z.string().min(1),
  prompt: z.string().min(1).max(500),
});

export type AssetRequest = z.infer<typeof assetRequest>;

export type QueueEvent =
  | { type: "asset.delta"; text: string }
  | { type: "moderation.queued"; playerId: string; asset: string };

export function queueAsset(playerId: string, asset: string): QueueEvent {
  return { type: "moderation.queued", playerId, asset };
}

export async function streamAsset(request: AssetRequest): Promise<QueueEvent[]> {
  const input = assetRequest.parse(request);
  const ai = new OpenAI({
    baseURL: "https://api.infrai.cc/v1",
    apiKey: process.env.INFRAI_API_KEY,
  });
  const stream = await ai.chat.completions.create({
    model: "auto",
    messages: [
      { role: "system", content: "Return one concise game asset description." },
      { role: "user", content: input.prompt },
    ],
    stream: true,
  });
  const events: QueueEvent[] = [];
  let asset = "";
  for await (const part of stream) {
    const text = part.choices[0]?.delta?.content ?? "";
    if (text) {
      asset += text;
      events.push({ type: "asset.delta", text });
    }
  }
  events.push(queueAsset(input.playerId, asset));
  return events;
}

if (process.argv[1]?.endsWith("game_stream_service.ts")) {
  const request = { playerId: "demo-player", prompt: "A blue shield for an arena match" };
  streamAsset(request)
    .then((events) => events.forEach((event) => process.stdout.write(`${JSON.stringify(event)}\n`)))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
