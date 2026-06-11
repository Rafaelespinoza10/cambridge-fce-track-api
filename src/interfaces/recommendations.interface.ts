export interface RecommendationFilters {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateRecommendationBody {
  status?: string;
}

export interface SafeRecommendation {
  id: string;
  skillId: string | null;
  skillName: string | null;
  title: string;
  description: string | null;
  recommendationType: string;
  priority: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateResult {
  created: number;
  updated: number;
  recommendations: SafeRecommendation[];
}
