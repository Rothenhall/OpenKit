import { Injectable } from '@nestjs/common';
import { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import type {
  Call,
  CompanyProfile,
  Outcome,
  ScoreDimension,
  Scorecard,
} from '../leads.types.js';

const OUTCOMES: Outcome[] = [
  'next_step_agreed',
  'callback',
  'declined',
  'unclear',
];
const DIMENSIONS: ScoreDimension['name'][] = [
  'Opening',
  'Discovery',
  'Objection handling',
  'Close',
];

const RUBRIC = `Outcomes mean: next_step_agreed (a concrete meeting or follow up was accepted), callback (they asked to talk later without committing), declined (they said no), unclear (too short or no buying signal either way).
Score anchors, apply to every dimension: 5 means specific and earned, with a quoted line as proof. 3 means attempted but generic. 1 means missing, or the call was too short to judge.
Evidence rule: every dimension note, strength and improvement must name the exact moment, quoting 12 words or fewer. Do not praise things that did not happen.`;

const REP_SYSTEM = `You coach human sales reps by reviewing a phone call transcript. The REP is the human practising, judge them only, never the lead.
Be specific and fair. ${RUBRIC}
Never suggest promising results or guaranteed outcomes.
Write in plain English, short sentences, no em dashes.
Reply with one JSON object and nothing else:
{
  "outcome": "next_step_agreed" | "callback" | "declined" | "unclear",
  "summary": string (2 sentences on how the call went overall),
  "dimensions": [ {"name": "Opening", "score": 1-5, "note": string}, {"name": "Discovery", ...}, {"name": "Objection handling", ...}, {"name": "Close", ...} ],
  "strengths": string[] (max 3, what went well, each with its moment),
  "improvements": string[] (max 3, where the rep needs to improve, each concrete and something to do next time),
  "betterMoves": string[] (max 3, each in the form "When you said X, try Y", with Y a stronger line for that exact moment),
  "coaching": string[] (max 3, habits that would make this person a better calling agent),
  "verdict": string (1 or 2 sentence final verdict on the rep)
}`;

const AI_SYSTEM = `You review an AI sales caller by reading a phone call transcript. The REP is the AI caller, judge it only, never the human buyer.
Be specific and fair. ${RUBRIC}
Write in plain English, short sentences, no em dashes.
Reply with one JSON object and nothing else:
{
  "outcome": "next_step_agreed" | "callback" | "declined" | "unclear",
  "summary": string (2 sentences on how well the AI caller did),
  "dimensions": [ {"name": "Opening", "score": 1-5, "note": string}, {"name": "Discovery", ...}, {"name": "Objection handling", ...}, {"name": "Close", ...} ],
  "strengths": string[] (max 3, what the AI did well, each with its moment),
  "improvements": string[] (max 3, where the AI caller fell short),
  "benefits": string[] (max 4, concrete benefits this kind of AI caller would bring to a cold calling pipeline: consistency, follow up speed, coverage, cost per dial, never missing a lead. Tie each benefit to something the transcript showed),
  "verdict": string (1 or 2 sentence final verdict on using this AI caller for cold outreach)
}`;

interface RawScorecard {
  outcome?: unknown;
  summary?: unknown;
  dimensions?: { name?: unknown; score?: unknown; note?: unknown }[];
  strengths?: unknown;
  improvements?: unknown;
  betterMoves?: unknown;
  coaching?: unknown;
  verdict?: unknown;
  benefits?: unknown;
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        .slice(0, max)
    : [];

export function normaliseScorecard(raw: RawScorecard): Scorecard {
  const dimensions = DIMENSIONS.map((name) => {
    const found = raw.dimensions?.find((d) => d.name === name);
    const score = Number(found?.score);
    return {
      name,
      score: Number.isFinite(score)
        ? Math.min(5, Math.max(1, Math.round(score)))
        : 1,
      note: typeof found?.note === 'string' ? found.note.trim() : '',
    };
  });
  return {
    outcome: OUTCOMES.includes(raw.outcome as Outcome)
      ? (raw.outcome as Outcome)
      : 'unclear',
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    dimensions,
    strengths: strings(raw.strengths, 3),
    improvements: strings(raw.improvements, 3),
    betterMoves: strings(raw.betterMoves, 3),
    coaching: strings(raw.coaching, 3),
    verdict: typeof raw.verdict === 'string' ? raw.verdict.trim() : '',
    benefits: strings(raw.benefits, 4),
  };
}

@Injectable()
export class ScoringService {
  constructor(private readonly sarvam: SarvamService) {}

  async score(profile: CompanyProfile, call: Call): Promise<Scorecard> {
    const aiIsRep = call.scenario.agentRole === 'rep';
    const repIs = aiIsRep ? 'AGENT (an AI caller)' : 'USER (a human rep)';
    const transcript = call.turns
      .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
      .join('\n');
    const company = [
      `Company: ${profile.name}. ${profile.oneLiner}`,
      profile.offerings.length
        ? `Offers: ${profile.offerings.join('; ')}`
        : '',
      profile.buyers.length ? `Sells to: ${profile.buyers.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const raw = await this.sarvam.chatJsonTask<RawScorecard>(
      [
        { role: 'system', content: aiIsRep ? AI_SYSTEM : REP_SYSTEM },
        {
          role: 'user',
          content: `${company}\nThe rep's goal: ${call.scenario.goal}\nThe rep is the ${repIs} in this transcript.\n\nTRANSCRIPT\n${transcript}`,
        },
      ],
      { temperature: 0.3 },
    );
    return normaliseScorecard(raw);
  }
}
