import { getDatabaseConnection } from '../../lib/database';
import { PracticeExercisesRepository } from '../../repositories/practice-exercises.repository';
import { PracticeAttemptsRepository } from '../../repositories/practice-attempts.repository';
import { PracticeAnswersRepository } from '../../repositories/practice-answers.repository';
import { StartPracticeAttemptService } from './start-practice-attempt.service';
import { GetActivePracticeAttemptService } from './get-active-practice-attempt.service';
import { GetPracticeAttemptService } from './get-practice-attempt.service';
import { SubmitPracticeAttemptService } from './submit-practice-attempt.service';
import { AbandonPracticeAttemptService } from './abandon-practice-attempt.service';

interface PracticeAttemptServices {
  startAttempt: StartPracticeAttemptService;
  getActiveAttempt: GetActivePracticeAttemptService;
  getAttempt: GetPracticeAttemptService;
  submitAttempt: SubmitPracticeAttemptService;
  abandonAttempt: AbandonPracticeAttemptService;
}

async function buildPracticeAttemptServices(): Promise<PracticeAttemptServices> {
  const dataSource = await getDatabaseConnection();

  return {
    startAttempt: new StartPracticeAttemptService(dataSource),
    getActiveAttempt: new GetActivePracticeAttemptService({
      repository: new PracticeAttemptsRepository(dataSource),
      exercisesRepository: new PracticeExercisesRepository(dataSource),
    }),
    getAttempt: new GetPracticeAttemptService({
      attempts: new PracticeAttemptsRepository(dataSource),
      exercises: new PracticeExercisesRepository(dataSource),
      answers: new PracticeAnswersRepository(dataSource),
    }),
    submitAttempt: new SubmitPracticeAttemptService(dataSource),
    abandonAttempt: new AbandonPracticeAttemptService({
      repository: new PracticeAttemptsRepository(dataSource),
    }),
  };
}

export { buildPracticeAttemptServices };
export type { PracticeAttemptServices };
