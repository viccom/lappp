// Restore the original config before rebuilding a binary without smoke-only flags.
// Do not rebuild after a failed restoration: the config state is then unknown.
export function createCleanup({ stopChild, restore, rebuild }) {
  let cleanupPromise;
  return () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        const errors = [];
        try {
          await stopChild();
        } catch (error) {
          errors.push(new Error('child app termination failed', { cause: error }));
        }
        try {
          await restoreAndRebuild({ restore, rebuild });
        } catch (error) {
          errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'smoke cleanup failed');
      })();
    }
    return cleanupPromise;
  };
}

export function createShutdownHandler({ cleanup, exit, report = () => {}, getExitCode = () => 0 }) {
  let shutdownPromise;
  return (signal, signalCode) => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        let exitCode = getExitCode() || signalCode;
        try {
          await cleanup();
        } catch (error) {
          report('[smoke] CLEANUP FAILED:', error);
          exitCode = 1;
        }
        exit(exitCode);
      })();
    }
    return shutdownPromise;
  };
}

export async function restoreAndRebuild({ restore, rebuild }) {
  try {
    await restore();
  } catch (cause) {
    throw new Error('config restoration failed; clean rebuild was not attempted', { cause });
  }

  try {
    await rebuild();
  } catch (cause) {
    throw new Error('clean rebuild failed after config restoration', { cause });
  }
}
