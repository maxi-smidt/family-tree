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

export interface StatisticsReport {
  tree_id: string;
  total_members: number;
  members_with_birth_date: number;
  members_with_death_date: number;
  average_lifespan: number | null;
  gender_distribution: GenderDistribution;
  birth_death_by_decade: DecadeCount[];
  lifespan_distribution: AgeGroup[];
  top_first_names: NameCount[];
  top_last_names: NameCount[];
}

/**
 * Statistics aggregated across the anchor tree and every tree reachable via
 * tree-in-tree links (bridge persons counted once). Superset of
 * `StatisticsReport` — `tree_id` stays the anchor tree's id.
 */
export interface CombinedStatisticsReport extends StatisticsReport {
  tree_count: number;
  included_tree_ids: string[];
}
