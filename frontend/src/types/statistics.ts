export interface GenderDistribution {
  male: number;
  female: number;
  other: number;
  unknown: number;
}

export interface DecadeCount {
  decade: string;
  births: number;
  deaths: number;
}

export interface AgeGroup {
  range: string;
  count: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface MemberYear {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  year: number;
  place: string | null;
}

export interface LifeSpan {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  birth_year: number;
  death_year: number;
  age: number;
}

export interface StatisticsReport {
  workspace_id: string;
  total_members: number;
  members_with_birth_date: number;
  members_with_death_date: number;
  average_lifespan: number | null;
  gender_distribution: GenderDistribution;
  birth_death_by_decade: DecadeCount[];
  lifespan_distribution: AgeGroup[];
  top_first_names: NameCount[];
  top_last_names: NameCount[];
  // Overview fields — optional so reports from an older backend still parse.
  living_count?: number;
  members_with_birthplace?: number;
  members_with_photo?: number;
  earliest_birth?: MemberYear | null;
  top_birthplaces?: NameCount[];
  longest_lives?: LifeSpan[];
}
