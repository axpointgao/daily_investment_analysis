import type { FundIndexItem, FundSuggestion } from '../types/fundIndex';
import { normalizeQuery } from './normalizeQuery';
import { MATCH_SCORE, SEARCH_CONFIG } from './stockIndexFields';

export interface FundSearchOptions {
  limit?: number;
  activeOnly?: boolean;
}

export function searchFunds(
  query: string,
  index: FundIndexItem[],
  options: FundSearchOptions = {},
): FundSuggestion[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const limit = options.limit || SEARCH_CONFIG.DEFAULT_LIMIT;
  const activeOnly = options.activeOnly !== false;
  const matched = index
    .filter((item) => !activeOnly || item.active)
    .map((item) => ({ item, score: calculateMatchScore(normalizedQuery, item) }))
    .filter((candidate) => candidate.score > 0);

  matched.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return (b.item.popularity || 0) - (a.item.popularity || 0);
  });

  return matched.slice(0, limit).map(({ item, score }) => ({
    fundCode: item.fundCode,
    fundName: item.fundName,
    fundType: item.fundType,
    matchType: determineMatchType(score),
    matchField: determineMatchField(normalizedQuery, item),
    score,
  }));
}

function calculateMatchScore(query: string, item: FundIndexItem): number {
  const code = normalizeQuery(item.fundCode);
  const name = normalizeQuery(item.fundName);
  const pinyinFull = normalizeQuery(item.pinyinFull || '');
  const pinyinAbbr = normalizeQuery(item.pinyinAbbr || '');
  const aliases = item.aliases?.map((alias) => normalizeQuery(alias)) || [];

  if (query === code) return 100;
  if (query === name) return 98;
  if (aliases.some((alias) => alias === query)) return 97;
  if (query === pinyinAbbr) return 96;

  let score = 0;
  if (code.startsWith(query)) score = Math.max(score, 80);
  if (name.startsWith(query)) score = Math.max(score, 79);
  if (pinyinAbbr.startsWith(query)) score = Math.max(score, 78);
  if (aliases.some((alias) => alias.startsWith(query))) score = Math.max(score, 77);

  if (code.includes(query)) score = Math.max(score, 60);
  if (name.includes(query)) score = Math.max(score, 59);
  if (pinyinFull.includes(query)) score = Math.max(score, 58);
  if (aliases.some((alias) => alias.includes(query))) score = Math.max(score, 57);

  return score;
}

function determineMatchType(score: number): FundSuggestion['matchType'] {
  if (score >= MATCH_SCORE.EXACT_MIN) return 'exact';
  if (score >= MATCH_SCORE.PREFIX_MIN) return 'prefix';
  if (score >= MATCH_SCORE.CONTAINS_MIN) return 'contains';
  return 'fuzzy';
}

function determineMatchField(query: string, item: FundIndexItem): FundSuggestion['matchField'] {
  const code = normalizeQuery(item.fundCode);
  const name = normalizeQuery(item.fundName);
  const pinyinFull = normalizeQuery(item.pinyinFull || '');
  const pinyinAbbr = normalizeQuery(item.pinyinAbbr || '');
  const aliases = item.aliases?.map((alias) => normalizeQuery(alias)) || [];

  if (code.includes(query)) return 'code';
  if (name.includes(query)) return 'name';
  if (pinyinFull.includes(query) || pinyinAbbr.includes(query)) return 'pinyin';
  if (aliases.some((alias) => alias.includes(query))) return 'alias';
  return 'name';
}
