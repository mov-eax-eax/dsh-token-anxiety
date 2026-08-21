// Unit tests for the pure internals of dsh-token-anxiety (node --test).
// Run with: npm test  (node --test test/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __test } from '../index.js'

const { clip, buildExplainPrompt, computeConversation, detectLanguageLlm, activePricing, PRICING, projectionDefinition } = __test

// ---- clip ------------------------------------------------------------------

test('clip passes short text through unchanged', () => {
  assert.equal(clip('hello', 100), 'hello')
  assert.equal(clip(null, 100), null)
  assert.equal(clip('', 100), '')
})

test('clip keeps head and tail of long text with a marker', () => {
  const long = 'x'.repeat(2000)
  const out = clip(long, 200)
  assert.ok(out.length < 200 + 64, 'clipped length stays near the budget')
  assert.ok(out.includes('[clipped'), 'marker present')
  assert.ok(out.startsWith('x'.repeat(120)), 'keeps the head')
  assert.ok(out.endsWith('x'.repeat(80)), 'keeps the tail')
})

// ---- buildExplainPrompt ----------------------------------------------------

test('buildExplainPrompt emits the four labeled lines and the numbers', () => {
  const t = { turn: 7, requests: 3, missTokens: 1000, hitTokens: 200, outputTokens: 50, cop: 12.5, postCop: 30, sharePct: 4.2, waste: [], toolCalls: [], toolErrors: [], retries: 0 }
  const p = buildExplainPrompt(t, { title: 'T', cwd: '/w', firstUser: 'do things' }, 'user prompt', 'prev prompt', 'en')
  for (const label of ['Wanted:', 'Happened:', 'Avoid:', 'Next time:']) assert.ok(p.includes(label), label + ' present')
  assert.ok(p.includes('turn #7'), 'task id present')
  assert.ok(p.includes('Requests: 3'), 'request count present')
  assert.ok(p.includes('$12.5 COP'), 'cost present')
})

test('buildExplainPrompt clips a huge user prompt', () => {
  const t = { turn: 1, requests: 1, missTokens: 1, hitTokens: 0, outputTokens: 0, cop: 1, postCop: 1, sharePct: 100, waste: [], toolCalls: [], toolErrors: [], retries: 0 }
  const huge = 'z'.repeat(5000)
  const p = buildExplainPrompt(t, { title: 'T', cwd: '/w', firstUser: 'start' }, huge, null, 'en')
  assert.ok(p.includes('[clipped'), 'long prompt is clipped')
  assert.ok(!p.includes(huge), 'full prompt is not embedded')
})

test('buildExplainPrompt asks for the analysis in the detected language', () => {
  const t = { turn: 1, requests: 1, missTokens: 1, hitTokens: 0, outputTokens: 0, cop: 1, postCop: 1, sharePct: 100, waste: [], toolCalls: [], toolErrors: [], retries: 0 }
  const p = buildExplainPrompt(t, { title: 'T', cwd: '/w', firstUser: '\u4fee\u590d\u95ee\u9898' }, '\u5e2e\u6211\u4fee\u590d', null, 'zh')
  assert.ok(p.includes('Chinese'), 'zh instruction present')
})

// ---- computeConversation ---------------------------------------------------

test('computeConversation folds usage into per-task cost (current vs peak/valley)', () => {
  const flash = activePricing.models['deepseek-v4-flash']
  const fx = activePricing.fx.usdCop
  const before = Date.parse('2026-08-15T12:00:00Z') // before effectiveFromUtc -> current regime
  const peak = Date.parse('2026-08-17T02:00:00Z')   // after effective, UTC hour 2 -> peak regime
  const events = [
    { type: 'request/header', data: { header: { config: { model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', time: before, data: { turn: 1, usage: { inputTokens: 1_000_000, cacheReadTokens: 100_000, outputTokens: 50_000 } } },
    { type: 'assistant/message', time: peak, data: { turn: 1, usage: { inputTokens: 500_000, cacheReadTokens: 0, outputTokens: 0 } } },
  ]
  const conv = computeConversation({ logs: [{ id: 'root', events }], labels: new Map(), rootId: 'root' })

  assert.equal(conv.taskCount, 1)
  assert.equal(conv.subagentCount, 0)
  assert.equal(conv.tasks.length, 1)
  const row = conv.tasks[0]
  assert.equal(row.requests, 2)
  assert.equal(row.missTokens, 1_500_000)
  assert.equal(row.hitTokens, 100_000)
  assert.equal(row.outputTokens, 50_000)

  // msg1 at pre-effective time uses current rates; msg2 at peak hour uses peak rates.
  const expectedCop = ((1_000_000 * flash.current.miss + 100_000 * flash.current.hit + 50_000 * flash.current.output) / 1e6 + (500_000 * flash.peak.miss) / 1e6) * fx
  assert.ok(Math.abs(row.cop - Math.round(expectedCop * 100) / 100) < 1e-6, 'current+peak fold cost matches')

  // postCop uses the post-hike regime: msg1 -> valley hour, msg2 -> peak hour.
  const expectedPost = ((1_000_000 * flash.valley.miss + 100_000 * flash.valley.hit + 50_000 * flash.valley.output) / 1e6 + (500_000 * flash.peak.miss) / 1e6) * fx
  assert.ok(Math.abs(row.postCop - Math.round(expectedPost * 100) / 100) < 1e-6, 'post cost matches')

  assert.ok(Math.abs(conv.postPeakCop - row.postPeakCop) < 1e-6, 'totals carry peak')
  assert.equal(conv.models.length, 1)
  assert.equal(conv.models[0].requests, 2)
  assert.equal(conv.models[0].totalTokens, 1_650_000)
})

test('computeConversation separates root tasks and subagents', () => {
  const events = (id, turn) => [
    { type: 'request/header', data: { header: { config: { model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', time: Date.parse('2026-08-15T12:00:00Z'), data: { turn, usage: { inputTokens: 1_000, cacheReadTokens: 0, outputTokens: 0 } } },
  ]
  const conv = computeConversation({
    logs: [
      { id: 'root', events: events('root', 1) },
      { id: 'child-1', events: events('child-1', 0) },
    ],
    labels: new Map([['child-1', 'sub task']]),
    rootId: 'root',
  })
  assert.equal(conv.taskCount, 1)
  assert.equal(conv.subagentCount, 1)
  const sub = conv.tasks.find((t) => t.sub)
  assert.ok(sub, 'subagent task present')
  assert.equal(sub.label, 'sub task')
})

// ---- detectLanguageLlm -----------------------------------------------------

function fakeLlm(text) {
  return {
    async *stream() {
      if (text) yield { type: 'text-delta', text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

test('detectLanguageLlm returns the ISO code from the model', async () => {
  assert.equal(await detectLanguageLlm(fakeLlm('zh'), 'p', 'm', 'sample'), 'zh')
  assert.equal(await detectLanguageLlm(fakeLlm('en'), 'p', 'm', 'sample'), 'en')
  assert.equal(await detectLanguageLlm(fakeLlm('eng'), 'p', 'm', 'sample'), 'en') // ISO-3 -> ISO-1
  assert.equal(await detectLanguageLlm(fakeLlm('The language is es.'), 'p', 'm', 'sample'), 'es')
})

test('detectLanguageLlm returns null on failure or garbage', async () => {
  assert.equal(await detectLanguageLlm(fakeLlm(''), 'p', 'm', 'sample'), null)
  assert.equal(await detectLanguageLlm(fakeLlm('???' ), 'p', 'm', 'sample'), null)
  const throwing = { async *stream() { throw new Error('boom') } }
  assert.equal(await detectLanguageLlm(throwing, 'p', 'm', 'sample'), null)
})

// ---- pricing defaults ------------------------------------------------------

test('default currencies are COP, USD, CNY', () => {
  // The embedded default (the gitignored pricing.override.json may carry a
  // machine-local chooser order and is not part of the code contract).
  assert.deepEqual(PRICING.currencies, ['COP', 'USD', 'CNY'])
})

// ---- projection definition (harness sessionProjections.register contract) --

test('projectionDefinition registers with the current harness shape (stateSchema + wire)', () => {
  const def = projectionDefinition()
  assert.equal(def.key, 'tokenAnxiety')
  // The harness registry reads stateSchema for the fold state...
  assert.ok(def.stateSchema && typeof def.stateSchema.parse === 'function', 'stateSchema with parse present')
  // ...and a wire block for the client-visible view. Without wire the unit is
  // host-only and the browser widget never receives a value.
  assert.ok(def.wire, 'wire block present')
  assert.ok(def.wire.viewSchema && typeof def.wire.viewSchema.parse === 'function', 'wire.viewSchema with parse present')
  assert.equal(typeof def.wire.view, 'function', 'wire.view is a function')
  assert.equal(typeof def.init, 'function')
  assert.equal(typeof def.apply, 'function')
  assert.ok(Number.isSafeInteger(def.stateVersion) && def.stateVersion >= 0)
})

test('projectionDefinition no longer carries the legacy top-level schema/view fields', () => {
  const def = projectionDefinition()
  assert.equal(def.schema, undefined, 'no legacy top-level schema field')
  assert.equal(def.view, undefined, 'no legacy top-level view field')
})
