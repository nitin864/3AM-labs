export type SourceLabel = 'Observed' | 'Inferred' | 'Experimentally supported' | 'Verified repair' | 'Inconclusive'

export type EventItem = {
  id: string
  time: string
  type: 'telemetry' | 'fault' | 'agent' | 'experiment'
  title: string
  detail: string
  source: SourceLabel
}

export type Hypothesis = {
  id: string
  title: string
  component: string
  state: 'supported' | 'rejected' | 'inconclusive'
  confidence: string
  supporting: string[]
  contradicting: string[]
  predictions: string[]
  result: string
}

export type LabData = {
  incidentId: string
  scenario: string
  status: 'Investigating' | 'Healthy' | 'Verifying'
  started: string
  events: EventItem[]
  hypotheses: Hypothesis[]
}
