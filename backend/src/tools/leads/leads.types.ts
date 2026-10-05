import type { LanguageCode } from '../../common/sarvam/languages.js';
import type { Gender, VoiceId } from '../../common/sarvam/voices.js';

export interface CompanyProfile {
  name: string;
  industry: string;
  oneLiner: string;
  offerings: string[];
  buyers: string[];
  proofPoints: string[];
  priceSignals: string;
  likelyObjections: string[];
  competitors: string[];
  tone: string;
  language: LanguageCode;
}

/** Who the AI plays. `rep` sells for the company, `lead` is the prospect. */
export type AgentRole = 'rep' | 'lead';
export type Difficulty = 'easy' | 'medium' | 'hard';

/** One grounded fact pulled from a single page. Extraction only, no personas. */
export interface EvidenceItem {
  id: string;
  type: 'offering' | 'buyer' | 'proof' | 'pricing' | 'objection' | 'other';
  claim: string;
  quote: string;
  sourceUrl: string;
  section: string;
  confidence: 'explicit' | 'inferred';
}

export interface UnderstoodProduct {
  name: string;
  description: string;
  capabilities: string[];
  problemsSolved: string[];
  targetBuyers: string[];
  valueProposition: string[];
  proof: string[];
  evidenceIds: string[];
}

export interface UnderstoodBuyer {
  role: string;
  offering: string;
  goals: string[];
  concerns: string[];
  buyingContexts: string[];
  evidenceIds: string[];
}

/** Canonical company understanding. Language independent, built once. */
export interface CompanyUnderstanding {
  name: string;
  whatTheyDo: string;
  category: string;
  language: string;
  products: UnderstoodProduct[];
  buyers: UnderstoodBuyer[];
  useCases: string[];
  buyingTriggers: string[];
  proofPoints: string[];
  commercialSignals: string[];
  competitors: string[];
  unknowns: string[];
  unsupportedClaims: string[];
  evidence: EvidenceItem[];
}

/** A planned scenario. Writing prose from this is independent per item. */
export interface ScenarioBlueprint {
  offering: string;
  buyer: string;
  seniority: string;
  buyingContext: string;
  buyerGoal: string;
  mood: string;
  primaryFriction: string;
  secondaryFrictions: string[];
  difficulty: Difficulty;
  evidenceIds: string[];
  forbiddenClaims: string[];
  repTrap: string;
  successCondition: string;
}

export interface Scenario {
  id: string;
  agentRole: AgentRole;
  title: string;
  situation: string;
  /** The prospect in the call, played by the AI when agentRole is `lead`. */
  lead: {
    name: string;
    gender: Gender;
    jobTitle: string;
    mood: string;
    objections: string[];
  };
  /** What a good outcome looks like for the rep. */
  goal: string;
  difficulty: Difficulty;
  language: LanguageCode;
  custom: boolean;
}

export interface Turn {
  speaker: 'agent' | 'user';
  text: string;
}

export type Outcome = 'next_step_agreed' | 'callback' | 'declined' | 'unclear';

export interface ScoreDimension {
  name: 'Opening' | 'Discovery' | 'Objection handling' | 'Close';
  /** 1 (weak) to 5 (strong). */
  score: number;
  note: string;
}

/** How the rep did. The rep is the user in `lead` mode and the agent in `rep` mode. */
export interface Scorecard {
  outcome: Outcome;
  summary: string;
  dimensions: ScoreDimension[];
  strengths: string[];
  improvements: string[];
  /** Stronger lines the rep could have used, each tied to a real moment. */
  betterMoves: string[];
  /** Habits that would make this rep a better calling agent. */
  coaching: string[];
  /** One or two sentence final verdict. */
  verdict: string;
  /** When the AI was the rep: what this kind of caller would do in a pipeline. */
  benefits: string[];
}

export interface Call {
  id: string;
  scenario: Scenario;
  language: LanguageCode;
  /** The Sarvam voice the agent speaks with, built in or a saved platform voice. */
  voice: VoiceId;
  turns: Turn[];
  ended: boolean;
  startedAt: number;
  /** Practice time chosen up front, 1 to 10 minutes. The call ends here. */
  practiceMinutes: number;
  endsAt: number;
  scorecard?: Scorecard;
}

export interface Session {
  id: string;
  url: string;
  profile: CompanyProfile;
  scenarios: Scenario[];
  /** Canonical understanding behind the profile. Powers future analysis. */
  understanding?: CompanyUnderstanding;
  calls: Map<string, Call>;
  expiresAt: number;
}
