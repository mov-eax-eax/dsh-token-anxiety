// dsh-token-anxiety host half.
//
// Registers the 'tokenAnxiety' session projection: a pure fold over the ROOT
// session log that accumulates per-turn token usage, cost (current vs post
// peak/valley regimes), tool-call signals and waste flags, then renders a
// bounded task list plus conversation totals. The browser half reads the
// projection through useProjection('tokenAnxiety'); the projection itself
// never calls the network or the model — the explain route and the
// explain_task tool do, on demand.
//
// Deliberate scope: ROOT-session tasks only. The projection fold is per-session
// and synchronous, so the subagent tree the dynamic plugin walked on demand
// cannot be aggregated here (that path needs the subagents registry + session
// query, both async). Subagent sessions do not appear in this widget.
//
// Pricing data: embedded defaults below, optionally overridden by a
// pricing.override.json written by the /token-anxiety/pricing-sync route
// (restart to apply). stateVersion folds the active pricing in, so any
// price change discards persisted projection-cache rows.

import { readFileSync, writeFileSync } from 'node:fs'

export const name = 'dsh-token-anxiety'
// The explain route lives on the harness webserver; a declared injection makes
// the loader wait for the service instead of racing row activation (the
// frontend-static row uses the same pattern).
export const inject = ['webServer']

const PRICING = {
  asOf: '2026-08-15',
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  effectiveFromUtc: '2026-08-16T16:00:00Z',
  peakWindowsUtc: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
  valleyFactor: 0.5,
  fx: {
    base: 'USD',
    usdCop: 3137.586264,
    rates: { USD: 1, COP: 3137.586264, CNY: 7.1, EUR: 0.85, BRL: 5.4 },
  },
  currencies: ['COP', 'USD', 'CNY'],
  models: {
    'deepseek-v4-flash': {
      current: { miss: 0.14, hit: 0.0028, output: 0.28 },
      peak: { miss: 0.44, hit: 0.014, output: 1.32 },
      valley: { miss: 0.22, hit: 0.007, output: 0.66 },
    },
    'deepseek-v4-pro': {
      current: { miss: 0.435, hit: 0.003625, output: 0.87 },
      peak: { miss: 1.32, hit: 0.044, output: 3.96 },
      valley: { miss: 0.66, hit: 0.022, output: 1.98 },
    },
  },
}

// Override file: written by the pricing-sync route, read at boot. Lives next
// to this module so it travels with the bundle and needs no service.
const OVERRIDE_FILE = import.meta.dirname + '/pricing.override.json'

function mergePricing(base, override) {
  if (!override || typeof override !== 'object' || !override.models) return base
  const models = { ...base.models }
  for (const key of Object.keys(override.models)) {
    const m = override.models[key]
    if (m && typeof m === 'object') models[key] = { ...(models[key] || {}), ...m }
  }
  return {
    ...base,
    ...override,
    models,
    peakWindowsUtc: Array.isArray(override.peakWindowsUtc) ? override.peakWindowsUtc : base.peakWindowsUtc,
    valleyFactor: typeof override.valleyFactor === 'number' ? override.valleyFactor : base.valleyFactor,
    currencies: Array.isArray(override.currencies) && override.currencies.length ? override.currencies : base.currencies,
    fx: (() => {
      const baseFx = base.fx || {}
      const overFx = (override && override.fx) || {}
      const baseRates = baseFx.rates || (typeof baseFx.usdCop === 'number' ? { USD: 1, COP: baseFx.usdCop } : { USD: 1 })
      const rates = { ...baseRates, ...(overFx.rates || {}) }
      const usdCop = typeof overFx.usdCop === 'number'
        ? overFx.usdCop
        : (typeof rates.COP === 'number' ? rates.COP : baseFx.usdCop)
      const merged = { base: overFx.base || baseFx.base || 'USD', usdCop, rates }
      if (overFx.fxFetchedAt) merged.fxFetchedAt = overFx.fxFetchedAt
      return merged
    })(),
  }
}

// Model list derives from the active pricing so a pricing update that adds a
// model surfaces it automatically (fold and view both key off this list).
let activePricing = PRICING
try {
  const parsed = JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8'))
  activePricing = mergePricing(PRICING, parsed)
} catch (e) {
  // No override file (or unreadable): the embedded pricing stays in effect.
}
const MODELS = Object.keys(activePricing.models)

function pricingVersion() {
  let h = 0
  const s = JSON.stringify(activePricing)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function isPeakUtc(ts) {
  const h = new Date(ts).getUTCHours()
  return activePricing.peakWindowsUtc.some((w) => h >= w.start && h < w.end)
}

function extractText(content) {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim()
  if (!Array.isArray(content)) return ''
  let s = ''
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') s += block.text
  }
  return s.replace(/\s+/g, ' ').trim()
}

function isSystemText(text) {
  return text.indexOf('Current runtime context') === 0
    || text.indexOf('<system-reminder>') === 0
    || text.indexOf('A skill is') === 0
    || text.indexOf('You are a coding agent') === 0
}

function emptySignals() {
  return { errs: 0, retries: 0, calls: {}, errCodes: [] }
}

function init() {
  return {
    pricing: activePricing,
    model: 'deepseek-v4-flash',
    turn: null,
    previews: {},
    signals: {},
    tasks: {},
    byModel: {},
    // Per-request cost split: `regime` is what actually billed (all 'current'
    // before the effective date, peak/valley by request hour after);
    // `postRegime` is the projected split under the new rates by request hour.
    regime: { current: 0, peak: 0, valley: 0 },
    postRegime: { peak: 0, valley: 0 },
  }
}

// Pure transition: previous state + one committed event -> next state. Every
// uninteresting event returns the same reference (the registry's Object.is gate).
function fold(state, event) {
  switch (event.type) {
    case 'request/header': {
      const config = event.data && event.data.header && event.data.header.config
      const model = config && typeof config.model === 'string' ? config.model : null
      if (model === null || !activePricing.models[model] || model === state.model) return state
      return { ...state, model }
    }
    case 'turn/start': {
      const turn = event.data && event.data.turn
      if (typeof turn !== 'number' || turn === state.turn) return state
      return { ...state, turn }
    }
    case 'user/message': {
      const turn = state.turn
      if (typeof turn !== 'number' || state.previews[turn]) return state
      const text = extractText(event.data && event.data.content)
      if (!text || isSystemText(text)) return state
      return { ...state, previews: { ...state.previews, [turn]: text.slice(0, 200) } }
    }
    case 'assistant/message': {
      const data = event.data
      const usage = data && data.usage
      if (!usage) return state
      const miss = usage.inputTokens || 0
      const hit = usage.cacheReadTokens || 0
      const out = usage.outputTokens || 0
      if (!miss && !hit && !out) return state
      const turn = typeof data.turn === 'number' ? data.turn : state.turn
      if (typeof turn !== 'number') return state
      const ts = typeof event.time === 'number' ? event.time : Date.now()
      const model = state.model
      const prices = activePricing.models[model]
      const reg = ts >= Date.parse(activePricing.effectiveFromUtc) ? (isPeakUtc(ts) ? 'peak' : 'valley') : 'current'
      const postReg = isPeakUtc(ts) ? 'peak' : 'valley'
      const missUsd = miss / 1e6
      const hitUsd = hit / 1e6
      const outUsd = out / 1e6
      const cop = missUsd * prices[reg].miss + hitUsd * prices[reg].hit + outUsd * prices[reg].output
      const postCop = missUsd * prices[postReg].miss + hitUsd * prices[postReg].hit + outUsd * prices[postReg].output
      const postPeak = missUsd * prices.peak.miss + hitUsd * prices.peak.hit + outUsd * prices.peak.output
      const postValley = missUsd * prices.valley.miss + hitUsd * prices.valley.hit + outUsd * prices.valley.output
      const task = state.tasks[turn]
      const nextTask = task
        ? {
          ...task,
          requests: task.requests + 1,
          miss: task.miss + miss,
          hit: task.hit + hit,
          out: task.out + out,
          cop: task.cop + cop,
          postCop: task.postCop + postCop,
          postPeak: task.postPeak + postPeak,
          postValley: task.postValley + postValley,
          last: Math.max(task.last, ts),
        }
        : { turn, requests: 1, miss, hit, out, cop, postCop, postPeak, postValley, last: ts }
      const bucket = state.byModel[model] || { requests: 0, miss: 0, hit: 0, out: 0, cop: 0, postCop: 0, postPeak: 0, postValley: 0 }
      const nextBucket = {
        requests: bucket.requests + 1,
        miss: bucket.miss + miss,
        hit: bucket.hit + hit,
        out: bucket.out + out,
        cop: bucket.cop + cop,
        postCop: bucket.postCop + postCop,
        postPeak: bucket.postPeak + postPeak,
        postValley: bucket.postValley + postValley,
      }
      const regime = { ...state.regime }
      regime[reg] = (regime[reg] || 0) + cop
      const postRegime = { ...state.postRegime }
      postRegime[postReg] = (postRegime[postReg] || 0) + postCop
      return {
        ...state,
        tasks: { ...state.tasks, [turn]: nextTask },
        byModel: { ...state.byModel, [model]: nextBucket },
        regime,
        postRegime,
      }
    }
    case 'tool/call': {
      const turn = typeof event.data.turn === 'number' ? event.data.turn : state.turn
      const name_ = event.data && event.data.name
      if (typeof turn !== 'number' || !name_) return state
      const signals = state.signals[turn] || emptySignals()
      const calls = { ...signals.calls, [name_]: (signals.calls[name_] || 0) + 1 }
      return { ...state, signals: { ...state.signals, [turn]: { ...signals, calls } } }
    }
    case 'tool/result': {
      const turn = typeof event.data.turn === 'number' ? event.data.turn : state.turn
      const error = event.data && event.data.error
      if (typeof turn !== 'number' || !error) return state
      const signals = state.signals[turn] || emptySignals()
      const code = String((error.code || error.name) || 'error')
      return {
        ...state,
        signals: {
          ...state.signals,
          [turn]: { ...signals, errs: signals.errs + 1, errCodes: signals.errCodes.concat(code).slice(0, 20) },
        },
      }
    }
    case 'llm/retry-started': {
      const turn = typeof event.data.turn === 'number' ? event.data.turn : state.turn
      if (typeof turn !== 'number') return state
      const signals = state.signals[turn] || emptySignals()
      return { ...state, signals: { ...state.signals, [turn]: { ...signals, retries: signals.retries + 1 } } }
    }
    default:
      return state
  }
}

// State -> wire payload. Runs on every state change; O(turns). Plain JSON.
function view(state) {
  const fx = activePricing.fx.usdCop
  const toCop = (usd) => Math.round(usd * fx * 100) / 100

  const turns = Object.keys(state.tasks).map(Number).sort((a, b) => a - b)
  const previewList = turns.map((turn) => ({
    turn,
    preview: (state.previews[turn] || '').slice(0, 160),
  }))

  const normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const tokenSet = (s) => new Set(String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 3))
  const similarity = (a, b) => {
    const A = tokenSet(a)
    const B = tokenSet(b)
    if (!A.size || !B.size) return 0
    let intersection = 0
    for (const word of A) if (B.has(word)) intersection += 1
    return intersection / (A.size + B.size - intersection)
  }

  const flags = []
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    const task = state.tasks[turn]
    const signals = state.signals[turn]
    const codes = []
    if (signals && signals.errs > 0) codes.push('tool-errors')
    if (signals && signals.retries > 0) codes.push('retries')
    const preview = previewList[i].preview
    if (preview) {
      for (let j = 0; j < i; j++) {
        const earlier = previewList[j].preview
        if (earlier && (normText(earlier) === normText(preview) || similarity(earlier, preview) >= 0.7)) {
          codes.push('repeat')
          break
        }
      }
    }
    if (task.requests > 0 && task.out < 100 && task.miss + task.hit > 50000) codes.push('tiny-output')
    flags.push({ turn, codes })
  }
  for (let i = 0; i + 1 < flags.length; i++) {
    const nextPreview = previewList[i + 1].preview
    if (nextPreview && /^(no|not|nope|wrong|revert|ignore|forget|wait|stop|undo|never mind|nvm|actually|instead|that'?s not|don'?t|do not)\b/i.test(nextPreview.slice(0, 80))) {
      if (!flags[i].codes.includes('corrected')) flags[i].codes.push('corrected')
    }
  }

  const flagByTurn = new Map(flags.map((entry) => [entry.turn, entry.codes]))
  const built = []
  let total = 0
  let post = 0
  for (const turn of turns) {
    const task = state.tasks[turn]
    const signals = state.signals[turn]
    const cop = toCop(task.cop)
    const postCop = toCop(task.postCop)
    total += cop
    post += postCop
    const calls = signals
      ? Object.entries(signals.calls)
        .map(([name_, count]) => ({ name: name_, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
      : []
    built.push({
      turn,
      session: null,
      sub: false,
      label: null,
      requests: task.requests,
      missTokens: task.miss,
      hitTokens: task.hit,
      outputTokens: task.out,
      totalTokens: task.miss + task.hit + task.out,
      cop,
      postCop,
      postPeakCop: toCop(task.postPeak),
      postValleyCop: toCop(task.postValley),
      last: task.last,
      preview: previewList.find((entry) => entry.turn === turn)?.preview || null,
      waste: flagByTurn.get(turn) || [],
      toolCalls: calls,
      toolErrors: signals ? signals.errCodes.slice(0, 6) : [],
      retries: signals ? signals.retries : 0,
    })
  }

  const totalCop = Math.round(total * 100) / 100
  const postCop = Math.round(post * 100) / 100
  const tasks = built.slice(-80).map((task) => ({
    ...task,
    sharePct: totalCop > 0 ? Math.round((task.cop / totalCop) * 1000) / 10 : 0,
  }))

  const models = []
  for (const model of MODELS) {
    const bucket = state.byModel[model]
    if (bucket && bucket.requests > 0) {
      models.push({
        model,
        requests: bucket.requests,
        missTokens: bucket.miss,
        hitTokens: bucket.hit,
        outputTokens: bucket.out,
        totalTokens: bucket.miss + bucket.hit + bucket.out,
        cop: toCop(bucket.cop),
        postCop: toCop(bucket.postCop),
        peakCop: toCop(bucket.postPeak),
        valleyCop: toCop(bucket.postValley),
        sharePct: 0,
      })
    }
  }
  for (const entry of models) {
    entry.sharePct = totalCop > 0 ? Math.round((entry.cop / totalCop) * 1000) / 10 : 0
  }

  let peakUsd = 0
  let valleyUsd = 0
  for (const model of MODELS) {
    const bucket = state.byModel[model]
    if (bucket) {
      peakUsd += bucket.postPeak
      valleyUsd += bucket.postValley
    }
  }

  return {
    pricing: {
      asOf: activePricing.asOf,
      source: activePricing.source,
      effectiveFromUtc: activePricing.effectiveFromUtc,
      peakWindowsUtc: activePricing.peakWindowsUtc,
      valleyFactor: activePricing.valleyFactor,
      fxUsdCop: fx,
      fxBase: activePricing.fx.base || 'USD',
      fxRates: activePricing.fx.rates || {},
      currencies: activePricing.currencies || ['COP', 'USD', 'CNY'],
      models: MODELS,
      rates: (() => {
        const r = {}
        for (const mn of MODELS) r[mn] = activePricing.models[mn]
        return r
      })(),
    },
    model: state.model,
    tasks,
    totalCop,
    postCop,
    postPeakCop: toCop(peakUsd),
    postValleyCop: toCop(valleyUsd),
    taskCount: turns.length,
    subagentCount: 0,
    hikePct: total > 0 ? Math.round((post / total - 1) * 1000) / 10 : 0,
    models,
    regime: state.regime || { current: 0, peak: 0, valley: 0 },
    postRegime: state.postRegime || { peak: 0, valley: 0 },
  }
}

// The registry only requires .parse; no zod dependency keeps the bundle
// dependency-free (install stays offline). The view already produces a
// strictly plain-JSON object.
const schema = {
  parse(value) {
    if (value === undefined || value === null || typeof value !== 'object') {
      throw new Error('tokenAnxiety projection view must be a plain object')
    }
    return value
  },
}

// ---- explain_task: per-task forensics agent tool ---------------------------
// Ported from the dynamic plugin's explain-task RPC: a grounded, per-task
// analysis (original user request, full task prompt, previous prompt, tool
// census, errors, tokens, cost) ending with plain-language prompt guidance.
// The tool runs async, so it aggregates the subagent tree like the dynamic
// host did. Registered on the profile-level `tools` registry; the token-saving
// preset's tools keep their names, so there is no collision. The widget's
// Explain button does not use this tool: it calls the /token-anxiety/explain
// host route (see apply) so the analysis needs no agent turn.

const logCache = new Map()
const descCache = new Map()

function explainSessionData(ctx, sessionId) {
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  let session = null
  let model
  if (sessionId && sessions) {
    const s = sessions.get(sessionId)
    if (s) session = s
  }
  if (!session && agents) {
    try {
      const initiator = agents.currentInitiator ? agents.currentInitiator() : undefined
      if (initiator && initiator.session) {
        session = initiator.session
        if (initiator.options) model = initiator.options.model
      } else if (agents.list) {
        const all = agents.list() || []
        const root = all.find((a) => a.id === sessionId) || all[0]
        if (root) {
          session = root.session
          if (root.options) model = root.options.model
        }
      }
    } catch (e) {}
  }
  return { session, model, sessionId: session ? session.id || sessionId : sessionId }
}

async function collectLogs(ctx, rootId) {
  if (!rootId) return { logs: [], labels: new Map(), rootId }
  const sessionsSvc = ctx.get('sessions')
  const subagents = ctx.get('subagents')
  const query = ctx.get('sessionQuery')
  const ids = [rootId]
  const labels = new Map()
  if (subagents) {
    const now = Date.now()
    const dc = descCache.get(rootId)
    if (dc && now - dc.at < 30000) {
      for (const id of dc.ids) ids.push(id)
      for (const entry of dc.labels) labels.set(entry[0], entry[1])
    } else {
      try {
        const desc = await subagents.listDescendants(rootId)
        const nids = []
        const nl = []
        for (const d of desc || []) {
          if (d && d.kind === 'child') {
            nids.push(d.id)
            if (d.label) nl.push([d.id, d.label])
          }
        }
        descCache.set(rootId, { ids: nids, labels: nl, at: now })
        for (const id of nids) ids.push(id)
        for (const entry of nl) labels.set(entry[0], entry[1])
      } catch (e) {}
    }
  }
  const logs = []
  for (const id of ids) {
    try {
      let evs = null
      const live = sessionsSvc && sessionsSvc.get(id)
      if (live && live.events) evs = live.events
      else if (query) {
        const now = Date.now()
        const cached = logCache.get(id)
        if (cached && now - cached.at < 60000) evs = cached.events
        else {
          const snap = await query.readSession(id)
          if (snap && snap.events) {
            logCache.set(id, { events: snap.events, at: now })
            evs = snap.events
          }
        }
      }
      if (evs) logs.push({ id, events: evs })
    } catch (e) {}
  }
  return { logs, labels, rootId }
}

function trackModel(ev, cur) {
  if (ev && ev.type === 'request/header' && ev.data && ev.data.header && ev.data.header.config && ev.data.header.config.model) {
    const m = ev.data.header.config.model
    if (activePricing.models[m]) return m
  }
  return cur
}

function collectPreviews(logs, rootId) {
  const previews = new Map()
  for (const { id, events } of logs) {
    const isRoot = id === rootId
    let curTurn = null
    const seen = new Set()
    for (const ev of events) {
      if (!ev || !ev.data) continue
      if (ev.type === 'turn/start') { curTurn = ev.data.turn; continue }
      if (ev.type !== 'user/message') continue
      const text = extractText(ev.data.content)
      if (!text || isSystemText(text)) continue
      const key = isRoot ? ('t:' + String(curTurn)) : ('s:' + String(id))
      if (!seen.has(key)) { seen.add(key); previews.set(key, text.slice(0, 160)) }
    }
  }
  return previews
}

function collectFullPrompts(logs, rootId) {
  const full = new Map()
  for (const { id, events } of logs) {
    const isRoot = id === rootId
    let curTurn = null
    const seen = new Set()
    for (const ev of events) {
      if (!ev || !ev.data) continue
      if (ev.type === 'turn/start') { curTurn = ev.data.turn; continue }
      if (ev.type !== 'user/message') continue
      const text = extractText(ev.data.content)
      if (!text || isSystemText(text)) continue
      const key = isRoot ? ('t:' + String(curTurn)) : ('s:' + String(id))
      if (!seen.has(key)) { seen.add(key); full.set(key, text.slice(0, 2000)) }
    }
  }
  return full
}

function collectContext(logs, rootId) {
  const out = { title: null, firstUser: null, cwd: null }
  for (const { id, events } of logs) {
    const isRoot = id === rootId
    for (const ev of events) {
      if (!ev) continue
      if (ev.type === 'session' && ev.data) { if (ev.data.cwd) out.cwd = String(ev.data.cwd); continue }
      if (ev.type === 'session/title' && ev.data) { const t = ev.data.title || ev.data.text; if (t) out.title = String(t).slice(0, 200); continue }
      if (!isRoot) continue
      if (!out.firstUser && ev.type === 'user/message' && ev.data) {
        const text = extractText(ev.data.content)
        if (text && !isSystemText(text)) out.firstUser = text.slice(0, 2000)
      }
    }
  }
  return out
}

function collectSignals(logs, rootId) {
  const out = new Map()
  for (const { id, events } of logs) {
    const isRoot = id === rootId
    for (const ev of events) {
      if (!ev || !ev.data) continue
      let key = null
      if (isRoot) { const tu = ev.data.turn; if (typeof tu === 'number') key = 't:' + String(tu) }
      else key = 's:' + String(id)
      if (!key) continue
      let w = out.get(key)
      if (!w) { w = { errs: 0, retries: 0, calls: {}, errCodes: [] }; out.set(key, w) }
      if (ev.type === 'tool/call') {
        const n = ev.data.name || '?'
        w.calls[n] = (w.calls[n] || 0) + 1
      } else if (ev.type === 'tool/result' && ev.data.error) {
        w.errs++
        const e = ev.data.error
        const code = (e && (e.code || e.name)) || 'error'
        w.errCodes.push(String(code))
      } else if (ev.type === 'llm/retry-started') {
        w.retries++
      }
    }
  }
  return out
}

function computeConversation(res) {
  const { logs, labels } = res
  const byTurn = new Map()
  const byChild = new Map()
  const byModel = {}
  const previews = collectPreviews(logs, res.rootId)
  const signals = collectSignals(logs, res.rootId)
  for (const mn of MODELS) byModel[mn] = { requests: 0, miss: 0, hit: 0, out: 0, cop: 0, postCop: 0, peak: 0, valley: 0 }
  const ems = Date.parse(activePricing.effectiveFromUtc)
  for (const { id, events } of logs) {
    const isRoot = id === res.rootId
    let cur = 'deepseek-v4-flash'
    for (const ev of events) {
      if (!ev) continue
      const nc = trackModel(ev, cur)
      if (nc !== cur) { cur = nc; continue }
      if (ev.type !== 'assistant/message') continue
      const d = ev.data
      if (!d || !d.usage) continue
      const u = d.usage
      const ts = typeof ev.time === 'number' ? ev.time : NaN
      let row
      if (isRoot) {
        const tu = d.turn
        row = byTurn.get(tu)
        if (!row) {
          row = { turn: tu, requests: 0, miss: 0, hit: 0, out: 0, cop: 0, postCop: 0, postPeak: 0, postValley: 0, last: 0, models: {} }
          byTurn.set(tu, row)
        }
      } else {
        row = byChild.get(id)
        if (!row) {
          row = { turn: 0, session: id, sub: true, label: labels.get(id) || String(id).slice(0, 8), requests: 0, miss: 0, hit: 0, out: 0, cop: 0, postCop: 0, postPeak: 0, postValley: 0, last: 0, models: {} }
          byChild.set(id, row)
        }
      }
      row.requests++
      const m = u.inputTokens || 0
      const h = u.cacheReadTokens || 0
      const o = u.outputTokens || 0
      row.miss += m
      row.hit += h
      row.out += o
      row.models[cur] = (row.models[cur] || 0) + 1
      if (Number.isFinite(ts) && ts > row.last) row.last = ts
      const reg = (Number.isFinite(ts) && ts >= ems) ? (isPeakUtc(new Date(ts)) ? 'peak' : 'valley') : 'current'
      const postReg = Number.isFinite(ts) ? (isPeakUtc(new Date(ts)) ? 'peak' : 'valley') : 'valley'
      const pr = activePricing.models[cur]
      const p = pr[reg]
      const pp = pr[postReg]
      row.cop += m / 1e6 * p.miss + h / 1e6 * p.hit + o / 1e6 * p.output
      row.postCop += m / 1e6 * pp.miss + h / 1e6 * pp.hit + o / 1e6 * pp.output
      row.postPeak += m / 1e6 * pr.peak.miss + h / 1e6 * pr.peak.hit + o / 1e6 * pr.peak.output
      row.postValley += m / 1e6 * pr.valley.miss + h / 1e6 * pr.valley.hit + o / 1e6 * pr.valley.output
      const bm = byModel[cur]
      bm.requests++
      bm.miss += m
      bm.hit += h
      bm.out += o
      bm.cop += m / 1e6 * p.miss + h / 1e6 * p.hit + o / 1e6 * p.output
      bm.postCop += m / 1e6 * pp.miss + h / 1e6 * pp.hit + o / 1e6 * pp.output
      bm.peak += m / 1e6 * pr.peak.miss + h / 1e6 * pr.peak.hit + o / 1e6 * pr.peak.output
      bm.valley += m / 1e6 * pr.valley.miss + h / 1e6 * pr.valley.hit + o / 1e6 * pr.valley.output
    }
  }
  const tasks = []
  let total = 0
  let post = 0
  const fin = (t) => {
    t.cop = Math.round(t.cop * activePricing.fx.usdCop * 100) / 100
    t.postCop = Math.round(t.postCop * activePricing.fx.usdCop * 100) / 100
    total += t.cop
    post += t.postCop
    tasks.push(t)
  }
  for (const t of [...byTurn.values()].sort((a, b) => a.turn - b.turn)) fin(t)
  for (const t of byChild.values()) fin(t)
  tasks.sort((a, b) => a.last - b.last)
  const keyOf = (t) => t.sub ? ('s:' + String(t.session)) : ('t:' + String(t.turn))
  const normTxt = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const tokSet = (s) => new Set(String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 3))
  const sim = (a, b) => {
    const A = tokSet(a)
    const B = tokSet(b)
    if (!A.size || !B.size) return 0
    let inter = 0
    for (const w of A) if (B.has(w)) inter++
    return inter / (A.size + B.size - inter)
  }
  const rootOrder = tasks.filter((t) => !t.sub).sort((a, b) => a.turn - b.turn)
  const subOrder = tasks.filter((t) => t.sub).sort((a, b) => a.last - b.last)
  for (const list of [rootOrder, subOrder]) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      const codes = []
      const ws = signals.get(keyOf(t))
      if (ws) {
        if (ws.errs > 0) codes.push('tool-errors')
        if (ws.retries > 0) codes.push('retries')
        t.toolCalls = Object.entries(ws.calls).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10)
        t.toolErrors = ws.errCodes.slice(0, 6)
        t.retries = ws.retries
      } else {
        t.toolCalls = []
        t.toolErrors = []
        t.retries = 0
      }
      const p = previews.get(keyOf(t))
      if (p) {
        for (let j = 0; j < i; j++) {
          const q = previews.get(keyOf(list[j]))
          if (q && (normTxt(q) === normTxt(p) || sim(q, p) >= 0.7)) { codes.push('repeat'); break }
        }
      }
      if (t.requests > 0 && t.out < 100 && (t.miss + t.hit) > 50000) codes.push('tiny-output')
      t.waste = codes
    }
  }
  for (let i = 0; i + 1 < rootOrder.length; i++) {
    const nxtP = previews.get(keyOf(rootOrder[i + 1]))
    if (nxtP && /^(no|not|nope|wrong|revert|ignore|forget|wait|stop|undo|never mind|nvm|actually|instead|that'?s not|don'?t|do not)\b/i.test(nxtP.slice(0, 80))) {
      const cur = rootOrder[i]
      if (!cur.waste.includes('corrected')) cur.waste.push('corrected')
    }
  }
  let peak = 0
  let valley = 0
  for (const mn of MODELS) { peak += byModel[mn].peak; valley += byModel[mn].valley }
  const models = []
  for (const mn of MODELS) {
    const bm = byModel[mn]
    if (bm.requests) {
      models.push({
        model: mn,
        requests: bm.requests,
        missTokens: bm.miss,
        hitTokens: bm.hit,
        outputTokens: bm.out,
        totalTokens: bm.miss + bm.hit + bm.out,
        cop: Math.round(bm.cop * activePricing.fx.usdCop * 100) / 100,
        postCop: Math.round(bm.postCop * activePricing.fx.usdCop * 100) / 100,
        peakCop: Math.round(bm.peak * activePricing.fx.usdCop * 100) / 100,
        valleyCop: Math.round(bm.valley * activePricing.fx.usdCop * 100) / 100,
        sharePct: 0,
      })
    }
  }
  const totalCop = Math.round(total * 100) / 100
  for (const mo of models) mo.sharePct = totalCop > 0 ? Math.round(mo.cop / totalCop * 1000) / 10 : 0
  const lastN = tasks.slice(-40).map((t) => ({
    turn: t.turn,
    session: t.session || null,
    sub: !!t.sub,
    label: t.label || null,
    requests: t.requests,
    missTokens: t.miss,
    hitTokens: t.hit,
    outputTokens: t.out,
    totalTokens: t.miss + t.hit + t.out,
    cop: t.cop,
    postCop: t.postCop,
    postPeakCop: Math.round(t.postPeak * activePricing.fx.usdCop * 100) / 100,
    postValleyCop: Math.round(t.postValley * activePricing.fx.usdCop * 100) / 100,
    last: typeof t.last === 'number' && Number.isFinite(t.last) ? t.last : 0,
    preview: (previews.get(keyOf(t)) || '').slice(0, 160) || null,
    sharePct: totalCop > 0 ? Math.round(t.cop / totalCop * 1000) / 10 : 0,
    waste: Array.isArray(t.waste) ? t.waste : [],
    toolCalls: Array.isArray(t.toolCalls) ? t.toolCalls : [],
    toolErrors: Array.isArray(t.toolErrors) ? t.toolErrors : [],
    retries: t.retries || 0,
  }))
  return {
    tasks: lastN,
    totalCop,
    postCop: Math.round(post * 100) / 100,
    postPeakCop: Math.round(peak * activePricing.fx.usdCop * 100) / 100,
    postValleyCop: Math.round(valley * activePricing.fx.usdCop * 100) / 100,
    taskCount: byTurn.size,
    subagentCount: byChild.size,
    models,
    hikePct: total > 0 ? Math.round((post / total - 1) * 1000) / 10 : 0,
  }
}

// ---- conversation language detection ----------------------------------------
// The analysis should read in the language of the user message being analyzed.
// Detection is a single tiny LLM call (a few tokens) that returns the ISO
// 639-1 code; no heuristic fallback. If the call fails or answers something
// unrecognized the analysis is written in English.
const LANG_NAME = { en: 'English', es: 'Spanish', zh: 'Chinese', ko: 'Korean', ja: 'Japanese', ru: 'Russian', fr: 'French', de: 'German', pt: 'Portuguese', ar: 'Arabic', he: 'Hebrew', th: 'Thai', it: 'Italian', nl: 'Dutch', tr: 'Turkish', vi: 'Vietnamese' }
const ISO3_TO_2 = { eng: 'en', spa: 'es', zho: 'zh', chi: 'zh', kor: 'ko', jpn: 'ja', rus: 'ru', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', por: 'pt', ara: 'ar', heb: 'he', tha: 'th', ita: 'it', nld: 'nl', dut: 'nl', tur: 'tr', vie: 'vi' }
async function detectLanguageLlm(llm, provider, model, sample) {
  if (!sample) return null
  const prompt = 'What language is this text written in? Reply with only the ISO 639-1 code (en, es, zh, ja, ko, fr, de, pt, ru, ar, he, th, it, nl, tr, vi, ...). The FIRST block is the message to classify; the later blocks are context and may be in other languages.\n\n' + sample
  const sys = 'You are a language detector. Reply with a single lowercase ISO 639-1 code and nothing else.'
  const request = { provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], system: sys, maxTokens: 8, temperature: 0 }
  let text = ''
  try {
    for await (const chunk of llm.stream(request)) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') text += chunk.block.text
    }
  } catch (e) {
    return null
  }
  const t = text.trim().toLowerCase()
  const two = t.match(/\b(?:en|es|zh|ko|ja|ru|fr|de|pt|ar|he|th|it|nl|tr|vi)\b/)
  if (two) return two[0]
  const three = t.match(/\b([a-z]{3})\b/)
  if (three && ISO3_TO_2[three[1]]) return ISO3_TO_2[three[1]]
  return null
}

// Clip a long text to its head and tail so big task prompts cannot bloat the
// LLM context (the main reason explain was slow and hit the token limit).
function clip(text, max) {
  if (!text) return text
  const s = String(text)
  if (s.length <= max) return s
  const head = Math.floor(max * 0.6)
  const tail = max - head
  return s.slice(0, head) + ' \u2026[clipped \u2014 ' + (s.length - max) + ' chars removed]\u2026 ' + s.slice(-tail)
}

function buildExplainPrompt(t, ctxInfo, fullPrompt, prevPrompt, lang) {
  const L = []
  L.push('You are analyzing one task of a coding-agent conversation to find where tokens were wasted and how to avoid it next time. Ground every claim in the quoted text below \u2014 do not invent what the user asked.')
  const langName = LANG_NAME[lang] || lang
  if (langName && lang !== 'en') {
    L.push('The conversation is written in ' + langName + '. Write the ENTIRE analysis \u2014 every section heading and the final user guidance included \u2014 in ' + langName + '.')
  }
  if (ctxInfo.title) L.push('Conversation title: ' + clip(ctxInfo.title, 160))
  if (ctxInfo.cwd) L.push('Working directory: ' + clip(ctxInfo.cwd, 160))
  L.push('ORIGINAL USER REQUEST (first message of the conversation \u2014 the user\u2019s overall intention):')
  L.push(ctxInfo.firstUser ? ('>>> ' + clip(ctxInfo.firstUser, 400)) : '>>> (no user message recorded at session start)')
  L.push('THIS TASK: ' + (t.sub ? ('subagent ' + String(t.label || t.session)) : ('turn #' + String(t.turn))))
  L.push('THIS TASK\u2019S USER PROMPT (full text):')
  L.push('>>> ' + (fullPrompt ? clip(fullPrompt, 600) : t.preview || '(no user prompt recorded for this task)'))
  if (prevPrompt) L.push('PREVIOUS TASK\u2019S USER PROMPT (what the conversation was doing right before this task):\n>>> ' + clip(prevPrompt, 250))
  L.push('Waste flags: ' + ((t.waste || []).join(', ') || 'none'))
  const calls = t.toolCalls || []
  if (calls.length) L.push('Tool calls in this task: ' + calls.map((c) => c.name + ' x' + c.count).join(', '))
  const errs = t.toolErrors || []
  if (errs.length) L.push('Tool errors in this task: ' + errs.join(', '))
  if (t.retries) L.push('Model retries: ' + t.retries)
  L.push('Requests: ' + t.requests + ' \u00b7 tokens: miss ' + (t.missTokens || 0) + ' / hit ' + (t.hitTokens || 0) + ' / out ' + (t.outputTokens || 0))
  L.push('Cost now: $' + t.cop + ' COP \u00b7 post-hike: $' + t.postCop + ' COP \u00b7 ' + (t.sharePct || 0) + '% of the conversation')
  L.push('Write a VERY SHORT analysis (30-60 words total, hard maximum 70 words) in plain text with EXACTLY these four labeled lines and nothing else:\nWanted: <one line: the gist of what the user asked>\nHappened: <one line: what the task did and why it cost / wasted what it did, with the actual numbers>\nAvoid: <one line: 1-2 concrete actions>\nNext time: <one line of plain, non-technical guidance the user can copy-paste as their next prompt, referring to the thing being worked on the way the user sees it and asking before exploring broadly>\nNo markdown headers, no bullets, no preamble, no extra lines.')
  return L.join('\n')
}

async function explainTask(ctx, args, onDelta) {
  const sd = explainSessionData(ctx, args && args.sessionId)
  if (!sd.sessionId) return { error: 'no session' }
  const key = args && args.key
  if (!key) return { error: 'no task key' }
  const res = await collectLogs(ctx, sd.sessionId)
  const conv = computeConversation(res)
  const idx = (conv.tasks || []).findIndex((t) => (t.sub ? 's:' + String(t.session) : 't:' + String(t.turn)) === key)
  const task = idx >= 0 ? conv.tasks[idx] : null
  if (!task) return { error: 'task not found: ' + key }
  const fullPrompts = collectFullPrompts(res.logs, res.rootId)
  const ctxInfo = collectContext(res.logs, res.rootId)
  const prevTask = idx > 0 ? conv.tasks[idx - 1] : null
  const prevPrompt = prevTask ? (fullPrompts.get(prevTask.sub ? 's:' + String(prevTask.session) : 't:' + String(prevTask.turn)) || prevTask.preview || null) : null
  const fullPrompt = fullPrompts.get(key) || task.preview || null
  const llm = ctx.get('llm')
  if (!llm) return { error: 'llm service unavailable' }
  let provider = null
  let model = null
  for (const { id, events } of res.logs) {
    if (id !== res.rootId) continue
    for (const ev of events) {
      if (ev && ev.type === 'request/header' && ev.data && ev.data.header && ev.data.header.config) {
        if (ev.data.header.config.provider) provider = ev.data.header.config.provider
        if (ev.data.header.config.model) model = ev.data.header.config.model
      }
    }
  }
  if (!provider) {
    try {
      const ps = llm.listProviders()
      if (ps && ps.length) provider = ps[0].provider || ps[0].name
    } catch (e) {}
  }
  if (!model) model = sd.model || 'deepseek-v4-flash'
  if (!provider || !model) return { error: 'no provider/model for LLM call' }
  // The analysis language follows the user message being analyzed: one tiny
  // LLM call returns the ISO 639-1 code of the task's prompt (with the
  // previous and most recent prompts as context). No heuristic fallback — if
  // the call fails or returns an unknown code the analysis is in English.
  const recentPrompts = [...fullPrompts.entries()].filter(([k]) => k.indexOf('t:') === 0).map(([, v]) => v).slice(-4).reverse()
  const langSample = [fullPrompt, prevPrompt, ...recentPrompts].filter((s) => typeof s === 'string' && s.trim()).join('\n---\n')
  let lang = null
  try {
    lang = await detectLanguageLlm(llm, provider, model, langSample)
  } catch (e) {}
  if (!lang || !LANG_NAME[lang]) lang = 'en'
  const prompt = buildExplainPrompt(task, ctxInfo, fullPrompt, prevPrompt, lang)
  const sys = 'You are an expert on coding-agent token efficiency. Answer in plain text only: no markdown headers, no preamble, no chain-of-thought reasoning. Produce the requested analysis in the language of the conversation and end with the user-facing prompt guidance section.'
  const request = { provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], system: sys, maxTokens: 300, temperature: 0.4 }
  const collect = async () => {
    let text = ''
    let truncated = false
    let failure = null
    for await (const chunk of llm.stream(request)) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
        if (onDelta) onDelta(chunk.text)
      } else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') {
        text += chunk.block.text
        if (onDelta) onDelta(chunk.block.text)
      } else if (chunk.type === 'finish' && chunk.reason) {
        if (chunk.reason.kind === 'max-tokens') truncated = true
        else if (chunk.reason.kind !== 'stop' && failure === null) {
          const f = chunk.reason.failure
          failure = (f && (f.message || f.code)) || chunk.reason.kind
        }
      }
    }
    return { text, truncated, failure }
  }
  let result
  try {
    result = await collect()
  } catch (e) {
    result = null
  }
  if (!result || !result.text.trim()) {
    try {
      result = await collect()
    } catch (e) {
      return { error: 'LLM call failed: ' + String((e && e.message) || e) }
    }
  }
  let out = result.text.trim()
  if (!out && result.failure) return { error: 'LLM call failed: ' + result.failure }
  if (result.truncated) out += EXPLAIN_TRUNCATED_MARKER
  return { text: out }
}

// ---- browser-trust fence for /token-anxiety/explain ------------------------
// The harness's api-request-trust predicate is package-internal and guards
// only the /api prefix, so this route reimplements it verbatim: a loopback or
// trustedHosts Host, no cross-site fetch marker, and a same-origin Origin when
// one is attached. trustedHosts comes from the web runtime (the same source
// the connection plugin's config reads), so LAN deployments behave like /api.
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL('https://' + entry).port
  return port === '' ? entryUrl.hostname : entryUrl.hostname + ':' + port
}
function isTrustedAuthority(hostUrl, trustedHosts) {
  return (trustedHosts || []).some((entry) => {
    try {
      const entryUrl = new URL('http://' + entry)
      return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host
    } catch (e) {
      return false
    }
  })
}
function isTrustedExplainRequest(req, trustedHosts) {
  const host = req.headers && req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch (e) { return false }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch (e) { return false }
}

// ---- official pricing sync -------------------------------------------------
// Fetches the DeepSeek pricing page and lets the model extract the prices:
// no layout scraping in code. The page text plus a strict JSON schema go to an
// LLM call; the returned JSON is validated and normalized into a future-proof
// override (explicit schema/currency/unit fields, models keyed by id, so a
// later pricing change updates numbers, never the structure).
const PRICING_SYNC_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
const CNY_TO_USD = 7.0

function pageToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildPricingPrompt(text) {
  return [
    'Extract pricing data from the DeepSeek API pricing documentation text below.',
    'Prices are in CNY (\u5143) per 1 million tokens. The page describes CURRENT prices',
    'and a FUTURE peak/valley regime (peak hours vs idle hours; the idle period is',
    'half of the peak price).',
    'Return ONLY a JSON object, no markdown fences, no prose, exactly this shape:',
    '{',
    '  "effectiveLocal": "YYYY-MM-DD HH:MM",',
    '  "peakWindowsLocal": [{"start": 9, "end": 12}],',
    '  "valleyFactor": 0.5,',
    '  "models": {',
    '    "<model id as written on the page>": {',
    '      "current": {"miss": 1, "hit": 0.02, "output": 2},',
    '      "peak": {"miss": 1, "hit": 0.02, "output": 2},',
    '      "valley": {"miss": 1, "hit": 0.02, "output": 2}',
    '    }',
    '  }',
    '}',
    'Field meanings:',
    '- effectiveLocal: the moment (Beijing time, UTC+8) the new peak/valley pricing starts, exactly as written on the page.',
    '- peakWindowsLocal: the peak-hour windows in Beijing time, 0-23, exactly as stated (e.g. 9:00-12:00 -> {"start":9,"end":12}).',
    '- valleyFactor: the ratio of idle-period to peak-period price (the page states idle = half of peak).',
    '- models: every model the page prices. miss = input cache miss, hit = input cache hit, output = output, CNY per 1M tokens.',
    '- current is the price in effect before effectiveLocal; peak/valley are the new rates (peak hours / idle hours).',
    'Copy the exact numbers from the page; do not invent, round, or convert currency.',
    'PAGE TEXT:',
    text,
  ].join('\n')
}

const PRICING_SYS = 'You extract exact pricing facts from a pricing page into a strict JSON schema. Output only the JSON object.'

async function runLlmJson(ctx, system, prompt) {
  const llm = ctx.get('llm')
  if (!llm) throw new Error('llm service unavailable')
  let provider = null
  try {
    const ps = llm.listProviders()
    if (ps && ps.length) provider = ps[0].provider || ps[0].name
  } catch (e) {}
  if (!provider) throw new Error('no provider for LLM call')
  const request = {
    provider,
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    system,
    maxTokens: 4000,
    temperature: 0,
  }
  let text = ''
  for await (const chunk of llm.stream(request)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') text += chunk.block.text
  }
  if (!text.trim()) throw new Error('LLM returned no text')
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(cleaned)
}

async function extractPricing(ctx, html) {
  const text = pageToText(html).slice(0, 9000)
  if (text.length < 200) throw new Error('official page returned no readable text')
  const out = await runLlmJson(ctx, PRICING_SYS, buildPricingPrompt(text))
  if (!out || typeof out !== 'object' || !out.models || typeof out.models !== 'object') {
    throw new Error('LLM did not return a pricing object')
  }
  const usd = (cny) => Math.round((cny / CNY_TO_USD) * 100000) / 100000
  const models = {}
  for (const [modelId, m] of Object.entries(out.models)) {
    if (!m || typeof m !== 'object') continue
    const cur = m.current || {}
    const peak = m.peak || {}
    const valley = m.valley || {}
    const val = (src, key) => (typeof src[key] === 'number' && src[key] > 0 ? src[key] : (typeof cur[key] === 'number' && cur[key] > 0 ? cur[key] : 0))
    const miss = val(cur, 'miss')
    const hit = val(cur, 'hit')
    const output = val(cur, 'output')
    if (!miss || !hit || !output) continue
    models[modelId] = {
      current: { miss: usd(miss), hit: usd(hit), output: usd(output) },
      peak: { miss: usd(val(peak, 'miss')), hit: usd(val(peak, 'hit')), output: usd(val(peak, 'output')) },
      valley: { miss: usd(val(valley, 'miss')), hit: usd(val(valley, 'hit')), output: usd(val(valley, 'output')) },
    }
  }
  if (!Object.keys(models).length) throw new Error('LLM pricing output contained no usable model')
  let effectiveFromUtc = null
  if (typeof out.effectiveLocal === 'string') {
    const m = out.effectiveLocal.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/)
    if (m) effectiveFromUtc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 8, Number(m[5]))).toISOString()
  }
  const windows = Array.isArray(out.peakWindowsLocal)
    ? out.peakWindowsLocal
      .filter((w) => w && typeof w.start === 'number' && typeof w.end === 'number')
      .map((w) => ({ start: (Math.round(w.start) - 8 + 24) % 24, end: (Math.round(w.end) - 8 + 24) % 24 }))
    : []
  if (!effectiveFromUtc || !windows.length) throw new Error('LLM pricing output lacks the effective date or peak windows')
  return {
    schema: 1,
    asOf: new Date().toISOString().slice(0, 10),
    source: PRICING_SYNC_URL,
    currency: 'USD',
    unit: 'per_1m_tokens',
    effectiveFromUtc,
    peakWindowsUtc: windows,
    valleyFactor: typeof out.valleyFactor === 'number' && out.valleyFactor > 0 ? out.valleyFactor : 0.5,
    fx: { usdCop: activePricing.fx.usdCop },
    models,
  }
}

// ---- FX rates (USD base) ---------------------------------------------------
// Fetched from the keyless open.er-api.com mirror and cached in the override
// ("daily, or until the user asks to change it"): a sync reuses rates fetched
// less than a day ago and only refetches when the cache is stale. A fetch
// failure falls back to whatever rates exist; it never fails the sync.
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const FX_CACHE_MS = 24 * 60 * 60 * 1000

function readOverride() {
  try {
    return JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8')) || {}
  } catch (e) {
    return {}
  }
}

// In-memory anti-abuse state for the explain route (LLM calls cost money).
const explainState = { last: 0, inFlight: 0 }
const EXPLAIN_TRUNCATED_MARKER = '\n\n[truncated \u2014 the analysis hit the token limit; ask again with a narrower task]'

async function fetchFxRates(existing) {
  const fx = existing && existing.fx
  if (fx && fx.rates && fx.fxFetchedAt) {
    const age = Date.now() - Date.parse(fx.fxFetchedAt)
    if (Number.isFinite(age) && age >= 0 && age < FX_CACHE_MS) {
      return { rates: fx.rates, fxFetchedAt: fx.fxFetchedAt, cached: true }
    }
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    let json
    try {
      const resp = await fetch(FX_URL, { signal: ctrl.signal })
      if (!resp.ok) throw new Error('FX endpoint returned HTTP ' + resp.status)
      json = await resp.json()
    } finally {
      clearTimeout(timer)
    }
    if (json && json.result === 'success' && json.rates && typeof json.rates.COP === 'number') {
      return { rates: json.rates, fxFetchedAt: new Date().toISOString(), cached: false }
    }
    throw new Error('FX endpoint response lacked rates')
  } catch (e) {
    const fallback = fx && fx.rates ? fx.rates : (activePricing.fx.rates || {})
    return { rates: fallback, fxFetchedAt: fx && fx.fxFetchedAt, cached: true }
  }
}

export function apply(ctx) {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'tokenAnxiety',
      schema,
      init,
      apply: fold,
      view,
      stateVersion: 4 + pricingVersion(),
    })
  })
  // Widget explain without an agent turn: a direct host route on the harness
  // webserver. The bundle has no client-to-host RPC channel, so the browser
  // half fetch()es this route instead of queueing a message. It sits outside
  // the /api prefix, so it applies the same browser-trust predicate itself
  // (loopback/trusted Host + same-origin Origin + sec-fetch-site), matching
  // the harness's api-request-trust fence.
  ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/token-anxiety/explain',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        const webRuntime = ctx.get('webRuntime')
        const trustedHosts = webRuntime && Array.isArray(webRuntime.trustedHosts) ? webRuntime.trustedHosts : []
        if (!isTrustedExplainRequest(req, trustedHosts)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'forbidden' }))
          return
        }
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 8192) {
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'payload too large' }))
            return
          }
        }
        let args = {}
        try { args = JSON.parse(raw || '{}') } catch (e) { args = {} }
        const task = args.task
        if (!Number.isInteger(task) || task < 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'task must be a positive integer' }))
          return
        }
        // Light anti-abuse guard: the analysis costs an LLM call, so throttle
        // starts (2s apart) and cap concurrent runs.
        const now = Date.now()
        if (explainState.inFlight >= 2 || now - explainState.last < 2000) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'too many requests' }))
          return
        }
        explainState.last = now
        explainState.inFlight += 1
        // The analysis streams back as NDJSON lines ({"delta": "…"} per chunk,
        // then {"error": "…"} or {"done": true, "truncated": bool}). The raw
        // node:http server writes flush immediately, so the widget can render
        // the answer as it is generated.
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
        let result
        try {
          result = await explainTask(ctx, { sessionId: args.sessionId, key: 't:' + task }, (delta) => {
            res.write(JSON.stringify({ delta }) + '\n')
          })
          if (result.error) {
            res.write(JSON.stringify({ error: result.error }) + '\n')
          } else {
            if (result.truncated) res.write(JSON.stringify({ delta: EXPLAIN_TRUNCATED_MARKER }) + '\n')
            res.write(JSON.stringify({ done: true, truncated: !!result.truncated }) + '\n')
          }
        } catch (e) {
          res.write(JSON.stringify({ error: String((e && e.message) || e) }) + '\n')
        } finally {
          explainState.inFlight -= 1
        }
        res.end()
      },
    }), 'token-anxiety: explain route')
  // Sync official pricing: fetch the DeepSeek pricing page, parse the current
  // and peak/valley tables, store the result in pricing.override.json (a
  // restart applies it, and the pricing-derived stateVersion discards stale
  // projection caches). Same browser-trust fence as the explain route.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/token-anxiety/pricing-sync',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      const webRuntime = ctx.get('webRuntime')
      const trustedHosts = webRuntime && Array.isArray(webRuntime.trustedHosts) ? webRuntime.trustedHosts : []
      if (!isTrustedExplainRequest(req, trustedHosts)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      let parsed
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 20000)
        let html
        try {
          const resp = await fetch(PRICING_SYNC_URL, { signal: ctrl.signal })
          if (!resp.ok) throw new Error('official page returned HTTP ' + resp.status)
          html = await resp.text()
        } finally {
          clearTimeout(timer)
        }
        parsed = await extractPricing(ctx, html)
        // FX rides along: cached daily (or reuse whatever exists on failure).
        const existing = readOverride()
        const fxRes = await fetchFxRates(existing)
        parsed.fx = {
          base: 'USD',
          usdCop: typeof fxRes.rates.COP === 'number' ? fxRes.rates.COP : activePricing.fx.usdCop,
          rates: fxRes.rates,
          ...(fxRes.fxFetchedAt ? { fxFetchedAt: fxRes.fxFetchedAt } : {}),
        }
        if (!Array.isArray(parsed.currencies) || !parsed.currencies.length) {
          parsed.currencies = Array.isArray(existing.currencies) && existing.currencies.length ? existing.currencies : activePricing.currencies
        }
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'pricing sync failed: ' + String((e && e.message) || e) }))
        return
      }
      try {
        writeFileSync(OVERRIDE_FILE, JSON.stringify(parsed, null, 2))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'could not write pricing override: ' + String((e && e.message) || e) }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, stored: parsed, note: 'restart dsh web to apply' }))
    },
  }), 'token-anxiety: pricing-sync route')
  // Persist the chooser's enabled-currency list into the override (add/remove).
  // Same browser-trust fence as the other routes.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/token-anxiety/currencies',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      const webRuntime = ctx.get('webRuntime')
      const trustedHosts = webRuntime && Array.isArray(webRuntime.trustedHosts) ? webRuntime.trustedHosts : []
      if (!isTrustedExplainRequest(req, trustedHosts)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 8192) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'payload too large' }))
          return
        }
      }
      let args = {}
      try { args = JSON.parse(raw || '{}') } catch (e) { args = {} }
      const list = args.currencies
      if (!Array.isArray(list) || list.length === 0 || list.length > 40) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'currencies must be a non-empty array (max 40)' }))
        return
      }
      const codes = []
      for (const c of list) {
        if (typeof c !== 'string' || !/^[A-Z]{3}$/.test(c) || codes.indexOf(c) >= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid or duplicate currency code in list' }))
          return
        }
        codes.push(c)
      }
      const existing = readOverride()
      try {
        writeFileSync(OVERRIDE_FILE, JSON.stringify({ ...existing, currencies: codes }, null, 2))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'could not write currencies: ' + String((e && e.message) || e) }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, currencies: codes, note: 'restart dsh web to apply' }))
    },
  }), 'token-anxiety: currencies route')
  const tools = ctx.get('tools')
  if (tools === undefined) return
  tools.register({
    name: 'explain_task',
    description: 'Analyze ONE task (turn) of the current conversation to find where tokens were wasted and how to avoid it: quotes the original user request, the task\u2019s own prompt, what happened (tool calls, errors, retries, tokens, cost), concrete avoidance actions, and a plain-language \u201chow to phrase the request next time\u201d the user can copy. Use it when the user asks to explain a specific task\u2019s cost or waste, or wants to phrase a better prompt. One small LLM call per invocation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: { type: 'number', description: 'The task (turn) number to explain, as shown by the token anxiety widget (e.g. 3).' },
        sessionId: { type: 'string', description: 'Optional exact session id; defaults to the current session.' },
      },
      required: ['task'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.text }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec && exec.signal && exec.signal.aborted) throw new Error('aborted')
      const task = args && args.task
      if (!Number.isInteger(task) || task < 1) return { text: 'Pass the task (turn) number to explain, e.g. task: 3.' }
      const result = await explainTask(ctx, { sessionId: args.sessionId, key: 't:' + task })
      const text = result.error ? ('Error: ' + result.error) : result.text
      return { text }
    },
  })
}
