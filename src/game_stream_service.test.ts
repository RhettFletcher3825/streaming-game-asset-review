import assert from "node:assert/strict";
import { queueAsset } from "./game_stream_service.js";

const event = queueAsset("player-7", "blue shield");
assert.deepEqual(event, {
  type: "moderation.queued",
  playerId: "player-7",
  asset: "blue shield",
});
console.log("queue decision: moderation.queued");
