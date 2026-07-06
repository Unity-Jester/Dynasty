// One labeled group of amber warning text, rendered only when nonempty. Used
// three times in ReportView (settings/roster/picks) so the grouping-with-
// heading rule lives in exactly one place.
export default function WarningsList({
  heading,
  warnings,
}: {
  heading: string;
  warnings: readonly string[];
}) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-amber-400/80 font-medium mb-1.5">
        {heading}
      </h3>
      <ul className="space-y-1">
        {warnings.map((warning) => (
          <li key={warning} className="text-sm text-amber-300/90 flex gap-2">
            <span aria-hidden="true">-</span>
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
