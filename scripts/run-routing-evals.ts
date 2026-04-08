import { runEvals } from '@mastra/core/evals';
import { routingEvalFixtures } from '@/lib/mastra/evals/routing-fixtures';
import { routingExpectationScorer } from '@/lib/mastra/evals/routing-scorer';
import { routingEvalWorkflow } from '@/lib/mastra/evals/routing-workflow';

async function main() {
  const failures: Array<{ name: string; reason: string; score: number }> = [];

  const result = await runEvals({
    target: routingEvalWorkflow,
    scorers: [routingExpectationScorer],
    data: routingEvalFixtures.map((fixture) => ({
      input: {
        name: fixture.name,
        title: fixture.title,
        description: fixture.description,
        historicalScorecard: fixture.historicalScorecard,
      },
      groundTruth: fixture.expected,
    })),
    onItemComplete: ({ item, scorerResults }) => {
      const scorerResult = scorerResults[routingExpectationScorer.id];
      const name = typeof item.input === 'object' && item.input && 'name' in item.input
        ? String(item.input.name)
        : 'unknown';

      console.log(
        `[routing-eval] ${name}: score=${scorerResult.score} reason=${scorerResult.reason}`,
      );

      if (scorerResult.score < 1) {
        failures.push({
          name,
          reason: String(scorerResult.reason ?? 'mismatch'),
          score: Number(scorerResult.score ?? 0),
        });
      }
    },
  });

  console.log(
    `[routing-eval] completed ${result.summary.totalItems} fixture(s); failures=${failures.length}`,
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `[routing-eval] FAIL ${failure.name}: score=${failure.score} reason=${failure.reason}`,
      );
    }
    process.exitCode = 1;
  }
}

void main();
