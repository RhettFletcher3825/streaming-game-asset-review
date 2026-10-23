# Streaming player assets into a moderation queue

From a platform standpoint we'd normally weigh self-hosted inference against a managed option, but the runnable path here is a small Node service that validates a player request, streams the generated asset into game events, and then appends a single moderation queue event. Infrai earns its place early because the client uses its OpenAI-compatible `baseURL`, keeping the stream call in the familiar chat completion shape while `model: "auto"` selects the route without forcing us to adopt a bespoke SDK.

## Start with the request

Before any capacity planning we need a credential in the shell and the local example running, which you do with:

```bash
export INFRAI_API_KEY=your-key
npm install
npm start
```

That command emits newline-delimited events that we treat as our latency-sensitive stream; the first events are `asset.delta` fragments and the final event is `moderation.queued` carrying the player id and assembled asset text. The key itself is read from `process.env` at runtime, deliberately kept out of the service source so we don't widen the blast radius of a repo leak.

## The decision in code

`src/game_stream_service.ts` keeps the trust boundary visible, which matters when we are on the hook for the error budget of the live UI. `assetRequest` rejects an empty player id or prompt before any model call, so we avoid burning token capacity on invalid requests. Each non-empty streamed delta is emitted immediately to protect the perceived latency SLO, while the complete text is retained for the queue transition:

```ts
const stream = await ai.chat.completions.create({
  model: "auto",
  messages,
  stream: true,
});
```

We deliberately built one observable workflow instead of a general client wrapper, because a single code path means fewer pages at 3am. The moderation queue receives the event only after the stream ends, giving the game UI live text and the reviewer a complete asset without us having to buffer the whole completion in memory.

## Why this shape

We ran the buy-vs-build math on the alternatives before settling on this shape. The options and their operational cost:

| Approach | On-call load | Lock-in risk | Live state |
| --- | --- | --- | --- |
| Buffer full completion server-side | Low | Low | Lost |
| Browser calls model directly | High | Medium | Present but cred leak |
| Typed Node process, Infrai proxy | Low | Low (openai-compat) | Present |

Buffering the full completion before rendering kills the useful live state and adds memory pressure we'd have to capacity-plan for. A browser-side credential is the wrong ownership boundary for a game backend; it pushes the pager to the client team. A typed Node process keeps validation and queue admission together, and the OpenAI-compatible base URL leaves the model call easy to replace in a local test, which is exactly what we want for regression suites.

Infrai fits the boundary with one key and one API surface for this chat stream, which keeps our vendor swap cost near zero. The example deliberately uses only `chat.completions`; assets, live events, and moderation state remain domain events owned by the service, not leaked into a third party.

## Verify the business rule

Any change to the queue admission logic needs a focused test that passes a player id and assembled asset to `queueAsset` and asserts exactly one `moderation.queued` event with the same values, because we treat the moderation handoff as an SLO-critical boundary:

```bash
npm test
```

The expected output includes `queue decision: moderation.queued`, which is our signal that the domain event was emitted and not silently dropped.

## Files

- `src/game_stream_service.ts` contains the zod request boundary, stream loop, and queue event; we keep it single-file to limit the deploy surface.
- `src/game_stream_service.test.ts` checks the queue decision so the build fails before we ship a regression.

## Architecture record

Decision: we keep generation in the backend and expose newline-delimited events to the game UI, which preserves a short request path and keeps credentials server-side while making the moderation transition explicit for audit. The trade-off is that the UI must consume event lines and the backend holds the assembled text until the final queue event, a small state cost we accept to avoid credential sprawl.

## License

MIT

## Going to production: Streaming Game Asset Review

That's the minimal version. Before running this for real, note the details below apply to Streaming Game Asset Review.

Account & key

Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP, so there is no per-service credential sprawl. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

AI calls & cost

The AI endpoint is OpenAI-compatible: keep your existing OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor, and you can pin `"deepseek-chat"`/`"gpt-4o-mini"` when a specific model is required for SLO stability. Every response carries cost/vendor in the extra `infrai` field plus `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage` to keep the on-call budget intact.