export function trafficDecisionDue(
  time: number,
  previous: number | undefined,
  urgent: boolean,
) {
  return (
    urgent ||
    previous === undefined ||
    time < previous ||
    time - previous >= 0.05 - 1e-9
  );
}
