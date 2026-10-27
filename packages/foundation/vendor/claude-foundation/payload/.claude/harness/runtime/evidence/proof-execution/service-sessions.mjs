// Owns the lifecycle of services started for one proof process. Keeping this
// adapter separate makes cleanup ordering and signal reclamation testable
// without involving the proof state machine.
export function createServiceSessions({ startRequiredServices, processRef = process }) {
  const liveSessions = new Set();
  let reclaimInstalled = false;

  function stopSession(session) {
    if (!liveSessions.delete(session)) return null;
    try { return session.stop(); } catch { return null; }
  }

  function stopAll(sessions) {
    return [...sessions].reverse().map(stopSession).filter(Boolean);
  }

  function installReclaim() {
    if (reclaimInstalled) return;
    reclaimInstalled = true;
    const reclaim = () => [...liveSessions].reverse().forEach(stopSession);
    processRef.on("exit", reclaim);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      processRef.on(signal, () => { reclaim(); processRef.exit(130); });
  }

  async function startTrackedServices(id, nodes, proofRunId) {
    installReclaim();
    const sessions = await startRequiredServices(id, nodes, proofRunId);
    sessions.forEach((session) => liveSessions.add(session));
    return sessions;
  }

  return { startTrackedServices, stopAll };
}
