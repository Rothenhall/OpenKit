import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import {
  LANGUAGES,
  isLanguageCode,
  type LanguageCode,
} from '../../../common/sarvam/languages.js';
import { isGender } from '../../../common/sarvam/voices.js';
import type {
  AgentRole,
  CompanyProfile,
  CompanyUnderstanding,
  Difficulty,
  EvidenceItem,
  Scenario,
  ScenarioBlueprint,
} from '../leads.types.js';

const MIN_SCENARIOS = 3;
const MAX_SCENARIOS = 5;
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const SHAPE = `Each scenario is an object with keys:
title (string, max 8 words),
situation (string, 1 or 2 sentences on why this call is happening and what the lead is dealing with),
lead (object: name (an Indian first and last name common in the region that speaks the call language), gender ("female" or "male", matching the name), jobTitle (a buyer role from the profile, or a close fit), mood (max 6 words), objections (string[], 2 or 3 things they will push back on, in their own words, tied to the offering or price)),
goal (string, the concrete next step a good rep wins, for example a booked 20 minute demo),
difficulty (easy, medium or hard, see below).`;

const CALIBRATION = `Difficulty sets the lead, not the product:
easy: open and curious, asks real questions, agrees when the rep is clear and relevant.
medium: busy and cautious, raises objections one at a time, warms up only to specific answers.
hard: short on time and sceptical, one line answers, tries to end early, agrees only after the rep earns it with something specific to their situation.`;

const RULES = `Ground everything in the company profile. Leads must be the kind of buyer this company really sells to. Make the scenarios clearly different from each other: vary seniority, vary mood, and never reuse the same objection theme twice. Do not promise results or rankings anywhere.`;

const DIRECTION: Record<AgentRole, string> = {
  rep: 'The AI plays the company rep making the call. A human plays the lead. Describe the lead the rep is calling.',
  lead: 'The AI plays the lead. A human plays the company rep. Describe the lead the rep has to win.',
};

const MATRIX_SYSTEM = `You plan cold call practice scenarios from a company understanding. Plan globally for diversity, do not write the final prose.
Hard constraints:
- Every blueprint's offering and buyer must exist in the understanding. Every evidence id must exist.
- Vary seniority, mood and friction across the set. Never reuse the same primary friction twice.
- Difficulty sets the lead: easy is open and curious, medium is busy and cautious, hard is sceptical and tries to end early.
Reply with one JSON object and nothing else:
{"blueprints": [{"offering": string, "buyer": string, "seniority": string, "buyingContext": string, "buyerGoal": string, "mood": string (max 6 words), "primaryFriction": string, "secondaryFrictions": string[] (max 2), "difficulty": "easy" | "medium" | "hard", "evidenceIds": string[], "forbiddenClaims": string[] (things the rep must never claim), "repTrap": string (the mistake a weak rep makes here), "successCondition": string (what earns the next step)}]}`;

interface RawBlueprint {
  offering?: unknown;
  buyer?: unknown;
  seniority?: unknown;
  buyingContext?: unknown;
  buyerGoal?: unknown;
  mood?: unknown;
  primaryFriction?: unknown;
  secondaryFrictions?: unknown;
  difficulty?: unknown;
  evidenceIds?: unknown;
  forbiddenClaims?: unknown;
  repTrap?: unknown;
  successCondition?: unknown;
}

const rawList = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        .map((s) => s.trim())
        .slice(0, max)
    : [];

function toBlueprint(
  raw: RawBlueprint,
  evidenceIds: Set<string>,
): ScenarioBlueprint | undefined {
  const offering = str(raw.offering);
  const buyer = str(raw.buyer);
  const difficulty = DIFFICULTIES.includes(raw.difficulty as Difficulty)
    ? (raw.difficulty as Difficulty)
    : 'medium';
  if (!offering || !buyer) return undefined;
  return {
    offering,
    buyer,
    seniority: str(raw.seniority),
    buyingContext: str(raw.buyingContext),
    buyerGoal: str(raw.buyerGoal),
    mood: str(raw.mood, 'neutral'),
    primaryFriction: str(raw.primaryFriction),
    secondaryFrictions: rawList(raw.secondaryFrictions, 2),
    difficulty,
    evidenceIds: rawList(raw.evidenceIds, 6).filter((id) =>
      evidenceIds.has(id),
    ),
    forbiddenClaims: rawList(raw.forbiddenClaims, 4),
    repTrap: str(raw.repTrap),
    successCondition: str(raw.successCondition),
  };
}

/** Only evidence relevant to this blueprint goes to the writer. */
function relevantEvidence(
  evidence: EvidenceItem[],
  blueprint: ScenarioBlueprint,
): EvidenceItem[] {
  const haystack =
    `${blueprint.offering} ${blueprint.buyer} ${blueprint.primaryFriction}`.toLowerCase();
  const tokens = new Set(haystack.split(/[^a-z]+/).filter((t) => t.length > 3));
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const picked: EvidenceItem[] = [];
  for (const id of blueprint.evidenceIds) {
    const item = byId.get(id);
    if (item) picked.push(item);
  }
  for (const item of evidence) {
    if (picked.length >= 6) break;
    if (byId.has(item.id) && picked.includes(item)) continue;
    const words = item.claim.toLowerCase().split(/[^a-z]+/);
    if (words.some((w) => tokens.has(w))) picked.push(item);
  }
  return picked.slice(0, 6);
}

/** A finished scenario is valid when it is complete and its theme is fresh. */
function validateScenario(s: Scenario, seenThemes: Set<string>): boolean {  if (!s.title || !s.situation || !s.lead.name || !s.goal) return false;
  if (s.lead.objections.length === 0) return false;
  const theme = s.lead.objections[0].toLowerCase().replace(/[^a-z ]/g, '');
  if (seenThemes.has(theme)) return false;
  seenThemes.add(theme);
  return true;
}

interface RawScenario {
  title?: unknown;
  situation?: unknown;
  lead?: {
    name?: unknown;
    gender?: unknown;
    jobTitle?: unknown;
    mood?: unknown;
    objections?: unknown;
  };
  goal?: unknown;
  difficulty?: unknown;
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback;

export function toScenario(
  raw: RawScenario,
  agentRole: AgentRole,
  language: LanguageCode,
  custom: boolean,
): Scenario {
  const objections = Array.isArray(raw.lead?.objections)
    ? raw.lead.objections.filter(
        (o): o is string => typeof o === 'string' && o.trim() !== '',
      )
    : [];
  return {
    id: randomUUID(),
    agentRole,
    title: str(raw.title, str(raw.lead?.jobTitle, 'Sales call')),
    situation: str(raw.situation),
    lead: {
      name: str(raw.lead?.name, 'The lead'),
      gender: isGender(raw.lead?.gender) ? raw.lead.gender : 'female',
      jobTitle: str(raw.lead?.jobTitle),
      mood: str(raw.lead?.mood, 'neutral'),
      objections: objections.slice(0, 3),
    },
    goal: str(raw.goal, 'Agree a clear next step'),
    difficulty: DIFFICULTIES.includes(raw.difficulty as Difficulty)
      ? (raw.difficulty as Difficulty)
      : 'medium',
    language,
    custom,
  };
}

@Injectable()
export class ScenariosService {
  constructor(private readonly sarvam: SarvamService) {}

  /**
   * Plans a blueprint matrix in one call, then writes every scenario in
   * parallel. Only failures go back for repair. Needs at least 3 to pass.
   */
  async generate(
    understanding: CompanyUnderstanding,
    agentRole: AgentRole,
    language: LanguageCode,
    count = 4,
  ): Promise<Scenario[]> {
    const n = Math.min(MAX_SCENARIOS, Math.max(MIN_SCENARIOS, count));
    const matrix = await this.sarvam.chatJsonTask<{
      blueprints?: RawBlueprint[];
    }>(
      [
        { role: 'system', content: MATRIX_SYSTEM },
        {
          role: 'user',
          content: `Call language: ${LANGUAGES[language]}. The AI plays ${agentRole === 'rep' ? 'the company rep' : 'the lead'}. Plan exactly ${n} blueprints.\n\nUNDERSTANDING\n${JSON.stringify(understanding)}`,
        },
      ],
      { temperature: 0.5 },
    );
    const evidenceIds = new Set(understanding.evidence.map((e) => e.id));
    const blueprints = (matrix.blueprints ?? [])
      .map((b) => toBlueprint(b, evidenceIds))
      .filter((b): b is ScenarioBlueprint => !!b)
      .slice(0, n);
    if (blueprints.length === 0) throw new Error('Model planned no scenarios');

    const write = (blueprint: ScenarioBlueprint) =>
      this.writeScenario(blueprint, understanding, agentRole, language);
    const seen = new Set<string>();
    const passed: Scenario[] = [];
    const failed: ScenarioBlueprint[] = [];
    const written = await Promise.allSettled(blueprints.map(write));
    for (let i = 0; i < written.length; i++) {
      const result = written[i];
      if (result.status !== 'fulfilled') {
        failed.push(blueprints[i]);
        continue;
      }
      const scenario = toScenario(result.value, agentRole, language, false);
      if (validateScenario(scenario, seen)) passed.push(scenario);
      else failed.push(blueprints[i]);
    }
    // Repair only failures, once each.
    for (const blueprint of failed) {
      if (passed.length >= n) break;
      try {
        const scenario = toScenario(
          await write(blueprint),
          agentRole,
          language,
          false,
        );
        if (validateScenario(scenario, seen)) passed.push(scenario);
      } catch {
        // drop blueprints that fail twice
      }
    }
    if (passed.length < MIN_SCENARIOS) {
      throw new Error('Model returned too few scenarios');
    }
    return passed.slice(0, MAX_SCENARIOS);
  }

  /** Writes final prose for one planned blueprint, with relevant evidence only. */
  private async writeScenario(
    blueprint: ScenarioBlueprint,
    understanding: CompanyUnderstanding,
    agentRole: AgentRole,
    language: LanguageCode,
  ): Promise<RawScenario> {
    const evidence = relevantEvidence(understanding.evidence, blueprint)
      .map((e) => `[${e.id}] ${e.claim} | "${e.quote}"`)
      .join('\n');
    return this.sarvam.chatJsonTask<RawScenario>(
      [
        {
          role: 'system',
          content: `You write one sales call scenario from the blueprint below. ${DIRECTION[agentRole]}\n${RULES}\n${SHAPE}\nThe call will be in ${LANGUAGES[language]}. Reply with the scenario as one JSON object and nothing else.`,
        },
        {
          role: 'user',
          content: `Company: ${understanding.name}. ${understanding.whatTheyDo}\n\nBLUEPRINT\n${JSON.stringify(blueprint)}\n\nEVIDENCE\n${evidence}`,
        },
      ],
      { temperature: 0.9 },
    );
  }

  /** Turns a plain sentence or a few fields from the user into a full scenario. */
  async createCustom(
    profile: CompanyProfile,
    agentRole: AgentRole,
    input: {
      description: string;
      difficulty?: Difficulty;
      language?: LanguageCode;
    },
  ): Promise<Scenario> {
    const language = isLanguageCode(input.language)
      ? input.language
      : profile.language;
    const raw = await this.sarvam.chatJsonTask<RawScenario>(
      [
        {
          role: 'system',
          content: `You design one realistic sales call scenario from the user's description. ${DIRECTION[agentRole]}\n${RULES}\n${CALIBRATION}\n${SHAPE}\nKeep every detail the user gave and fill in only what is missing. The call will be in ${LANGUAGES[language]}. ${input.difficulty ? `Difficulty must be ${input.difficulty}.` : ''} Reply with the scenario as one JSON object and nothing else.`,
        },
        {
          role: 'user',
          content: `Company profile: ${JSON.stringify(profile)}\n\nUser description: ${input.description}`,
        },
      ],
      { temperature: 0.7 },
    );
    const scenario = toScenario(raw, agentRole, language, true);
    if (input.difficulty) scenario.difficulty = input.difficulty;
    return scenario;
  }
}
