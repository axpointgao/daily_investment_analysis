export interface FundIndexItem {
  fundCode: string;
  fundName: string;
  pinyinFull?: string;
  pinyinAbbr?: string;
  aliases?: string[];
  fundType?: string;
  active: boolean;
  popularity?: number;
}

export interface FundSuggestion {
  fundCode: string;
  fundName: string;
  fundType?: string;
  matchType: 'exact' | 'prefix' | 'contains' | 'fuzzy';
  matchField: 'code' | 'name' | 'pinyin' | 'alias';
  score: number;
}

export type FundIndexData = FundIndexItem[];
