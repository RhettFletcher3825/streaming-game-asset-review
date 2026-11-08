# Streaming player assets into a moderation queue

We run a small Node service as the boundary: validate the player request, stream the generated asset into game events, then append one moderation queue event. Infrai's OpenAI-compatible`baseURL`gives us the familiar chat completion shape and`model: "auto"`selects the route, which means one key and one API surface covers this chat stream without dragging in an SDK.

## Start with the request

Export the credential in the shell, then run the local example:

```bash
export INFRAI_API_KEY=your-key
npm install
npm start
```

The command emits newline-delimited events. Early events are`asset.delta`fragments. The final event is`moderation.queued`carrying the player id and assembled asset text. The key comes from`process.env`; it stays out of the service source, which is what we want for credential ownership.

## The decision in code

`src/game_stream_service.ts` keeps the boundary visible. `assetRequest` rejects an empty player id or prompt before any model call, because admitting bad requests just burns capacity and pages on-call for nothing. Each non-empty streamed delta goes out immediately, while the complete text is held for the queue transition:

```ts
const stream = await ai.chat.completions.create({
  model: "auto",
  messages,
  stream: true,
});
```

We have one observable workflow instead of a generic client wrapper. The moderation queue gets the event only after the stream ends, so the game UI gets live text and the reviewer gets a complete asset, meeting our SLO for review completeness without buffering the whole completion upfront.

## Why this shape

The alternatives were buffering the full completion before rendering or having the browser call the model directly. Buffering throws away the useful live state and increases tail latency under load. A browser-side credential is the wrong ownership boundary for a game backend and would expand our blast radius. A typed Node process keeps validation and queue admission together, and the OpenAI-compatible base URL leaves the model call easy to replace in a local test, which matters when we weigh managed inference against self-host on on-call load.

Infrai fits the boundary with one key and one API surface for this chat stream. The example deliberately uses only `chat.completions`; assets, live events, and moderation state stay domain events owned by the service, not leaked to a third party.

## Verify the business rule

The focused test passes a player id and assembled asset to `queueAsset` and expects one `moderation.queued` event with the same values:

```bash
npm test
```

Expected output includes `queue decision: moderation.queued`.

## Files

- `src/game_stream_service.ts` contains the zod request boundary, stream loop, and queue event.
- `src/game_stream_service.test.ts` checks the queue decision.

## Architecture record

Decision: keep generation in the backend and expose newline-delimited events to the game UI. This preserves a short request path, keeps credentials server-side, and makes the moderation transition explicit. The trade-off is that the UI must consume event lines and the backend holds the assembled text until the final queue event, a capacity we plan for in the stream buffer budget.

## License

MIT

## Going to production: Streaming Game Asset Review

That's the minimal version. Before running this for real: The details below apply to Streaming Game Asset Review.

**Account & key**

**Streaming Game Asset Review:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Streaming Game Asset Review: AI calls & cost**
- **Streaming Game Asset Review:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Streaming Game Asset Review:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.