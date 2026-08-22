/**
 * Phase 2 load test: LoopTracker instances must never bleed state into each
 * other under concurrent, interleaved use.
 *
 * Pure in-process test — no DB, no network. LoopTracker (see
 * src/lib/governance/loop-detector.ts) is instantiated once per heartbeat
 * run and holds its call-signature counts in a private per-instance Map, so
 * this is really proving "separate objects stay separate under concurrency"
 * — but that guarantee is exactly what protects one agent's heartbeat run
 * from tripping another's loop detector when many heartbeats execute in the
 * same process at once.
 *
 * 20 LoopTracker instances all receive the IDENTICAL tool-call signature.
 * Calls across all 20 instances are interleaved via microtask yields
 * (Promise.all + `await Promise.resolve()` between each call) to simulate
 * concurrent heartbeat runs sharing the process. Each tracker uses the
 * default threshold of 3, so every instance must throw LoopDetectedError on
 * its own 3rd identical call — never earlier (which would mean it inherited
 * count from another instance) and never later/never (which would mean its
 * own calls were being diverted into shared state).
 */
import '../governance/load-env';
import { LoopTracker, LoopDetectedError } from '@/lib/governance/loop-detector';

const INSTANCE_COUNT = 20;
const CALLS_PER_INSTANCE = 5;
const EXPECTED_THROW_AT_CALL = 3; // LoopTracker default threshold

function evidence(label: string, data: unknown) {
  console.log(`\nEVIDENCE [${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

type InstanceResult = {
  idx: number;
  threwAtCall: number | null;
  throwCount: number;
  unexpectedError: string | null;
};

async function runInstance(idx: number): Promise<InstanceResult> {
  const tracker = new LoopTracker();
  let threwAtCall: number | null = null;
  let throwCount = 0;
  let unexpectedError: string | null = null;

  for (let call = 1; call <= CALLS_PER_INSTANCE; call++) {
    // Yield to the event loop twice so all 20 instances' calls interleave
    // rather than each instance running its 5 calls back-to-back.
    await Promise.resolve();
    await Promise.resolve();
    try {
      tracker.checkAndRecord('search_workspace', {
        query: 'IDENTICAL_SIGNATURE',
        sharedAcrossAllInstances: true,
      });
    } catch (err) {
      if (err instanceof LoopDetectedError) {
        throwCount += 1;
        if (threwAtCall === null) threwAtCall = call;
      } else {
        unexpectedError = String(err);
      }
    }
  }

  return { idx, threwAtCall, throwCount, unexpectedError };
}

async function main() {
  const results = await Promise.all(
    Array.from({ length: INSTANCE_COUNT }, (_, idx) => runInstance(idx)),
  );

  evidence('loop-tracker-isolation', {
    instanceCount: INSTANCE_COUNT,
    callsPerInstance: CALLS_PER_INSTANCE,
    expectedThrowAtCall: EXPECTED_THROW_AT_CALL,
    results,
  });

  const noEarlyThrows = results.every(
    (r) => r.threwAtCall === null || r.threwAtCall >= EXPECTED_THROW_AT_CALL,
  );
  const allThrewOnTime = results.every((r) => r.threwAtCall === EXPECTED_THROW_AT_CALL);
  const noUnexpectedErrors = results.every((r) => r.unexpectedError === null);

  const pass = noEarlyThrows && allThrewOnTime && noUnexpectedErrors;

  console.log(
    pass
      ? `PASS: all ${INSTANCE_COUNT} concurrently-interleaved LoopTracker instances threw on exactly their own ${EXPECTED_THROW_AT_CALL}rd identical call — no cross-instance state bleed`
      : `FAIL: earlyThrow=${!noEarlyThrows} lateOrMissingThrow=${!allThrewOnTime} unexpectedErrors=${!noUnexpectedErrors}`,
  );

  process.exitCode = pass ? 0 : 1;
  process.exit(process.exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
