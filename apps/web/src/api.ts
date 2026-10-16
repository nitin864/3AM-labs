import type { LabData, EventItem } from './types'

export const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export const cachedLab: LabData = {
  incidentId: 'inc-2026-10-16-0042',
  scenario: 'fault-4-timeout-mismatch',
  status: 'Investigating',
  started: '14:02:11 UTC',
  events: [
    { id: 'e1', time: '14:02:11', type: 'telemetry', title: 'Incident started', detail: 'Gateway p95 crossed 150 ms · 20 requests sampled', source: 'Observed' },
    { id: 'e2', time: '14:02:12', type: 'fault', title: 'Timeout mismatch activated', detail: 'Caller 150 ms / downstream 220 ms', source: 'Observed' },
    { id: 'e3', time: '14:02:13', type: 'telemetry', title: 'False timeouts detected', detail: '20/20 caller errors · downstream completed 20/20', source: 'Observed' },
    { id: 'e4', time: '14:03:04', type: 'agent', title: 'Hypothesis ranking complete', detail: '3 candidates · 1 mechanism candidate', source: 'Inferred' },
    { id: 'e5', time: '14:03:17', type: 'experiment', title: 'Control / treatment replica started', detail: 'Workload checkout-burst · 20 requests', source: 'Experimentally supported' },
    { id: 'e6', time: '14:03:19', type: 'experiment', title: 'Treatment reproduced symptom', detail: 'False timeout rate 100% · cleanup succeeded', source: 'Experimentally supported' },
  ],
  hypotheses: [
    { id: 'h1', title: 'Caller timeout is shorter than downstream work', component: 'gateway → orders', state: 'supported', confidence: 'High · 96%', supporting: ['20 false timeouts in treatment', 'Downstream completed 20/20'], contradicting: ['None in replay'], predictions: ['Increasing caller timeout removes false timeouts', 'Downstream completion count remains stable'], result: 'Supported by control/treatment/after rule.' },
    { id: 'h2', title: 'Inventory pool exhaustion causes request failures', component: 'inventory', state: 'rejected', confidence: 'Low · 12%', supporting: ['Inventory is on the affected path'], contradicting: ['Pool utilization stayed at 42%', 'No inventory errors observed'], predictions: ['Pool saturation should precede errors'], result: 'Rejected: predicted saturation was not measured.' },
    { id: 'h3', title: 'Queue poison message amplifies latency', component: 'orders queue', state: 'inconclusive', confidence: 'Medium · 41%', supporting: ['Latency tail is elevated'], contradicting: ['No poison marker in logs'], predictions: ['Removing the message lowers p99'], result: 'Inconclusive: the dedicated experiment was not measured.' },
  ],
}

type IncidentResponse = { data: LabData; live: boolean }

export async function getIncident(): Promise<IncidentResponse> {
  if (!API_BASE) return { data: cachedLab, live: false }
  try {
    const response = await fetch(`${API_BASE}/api/incidents/${cachedLab.incidentId}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { data: await response.json() as LabData, live: true }
  } catch {
    return { data: cachedLab, live: false }
  }
}

export async function postAction(path: string, body: Record<string, unknown> = {}) {
  if (!API_BASE) return false
  try {
    const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return response.ok
  } catch { return false }
}

export function subscribeToEvents(incidentId: string, onEvent: (event: EventItem) => void) {
  if (!API_BASE || typeof EventSource === 'undefined') return () => undefined
  const source = new EventSource(`${API_BASE}/api/incidents/${incidentId}/events`)
  source.onmessage = (message) => {
    try { onEvent(JSON.parse(message.data) as EventItem) } catch { /* Ignore malformed server event. */ }
  }
  return () => source.close()
}
