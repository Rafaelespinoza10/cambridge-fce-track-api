import { calculatePracticeInsights } from '@lib/practice/practice-insights-calculator';
import type { PracticeInsights } from '../../interfaces/practice/practice-adaptive.interface';
import type { PracticeInsightsRepository } from '@repositories/practice/practice-insights.repository';
export class GetPracticeInsightsService {
  constructor(
    private readonly repository: Pick<PracticeInsightsRepository, 'listRows'>,
    private readonly now = () => new Date(),
  ) {}
  async execute(userId: string): Promise<PracticeInsights> {
    const now = this.now();
    return calculatePracticeInsights(
      await this.repository.listRows(userId, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
      now,
    );
  }
}
