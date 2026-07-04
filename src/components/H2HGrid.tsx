import { HeadToHeadRecord, getH2HForOwners } from '@/lib/sleeper';

interface Owner {
  id: string;
  name: string;
}

interface H2HGridProps {
  owners: Owner[];
  h2hRecords: Map<string, HeadToHeadRecord>;
}

// All-time head-to-head rivalry grid. Rows read left to right: the row
// owner's record against each column owner.
export default function H2HGrid({ owners, h2hRecords }: H2HGridProps) {
  if (owners.length < 2) return null;

  const cellFor = (rowOwner: Owner, colOwner: Owner) => {
    if (rowOwner.id === colOwner.id) {
      return <span className="text-gray-700">—</span>;
    }
    const record = getH2HForOwners(h2hRecords, rowOwner.id, colOwner.id);
    if (!record) {
      return <span className="text-gray-600 text-xs">0-0</span>;
    }
    const { wins, losses, ties } = record;
    const color =
      wins > losses ? 'text-sleeper-green' : losses > wins ? 'text-sleeper-red' : 'text-gray-400';
    return (
      <span className={`${color} font-medium tabular-nums`}>
        {wins}-{losses}
        {ties > 0 ? `-${ties}` : ''}
      </span>
    );
  };

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-lg font-semibold text-white">Head-to-Head Rivalries</h2>
        <p className="text-sm text-gray-400">
          All-time records across every season (read across: row team&apos;s record vs column team)
        </p>
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 bg-sleeper-darker p-2" />
              {owners.map(owner => (
                <th
                  key={owner.id}
                  className="p-2 text-xs text-gray-400 font-medium max-w-[90px] truncate"
                  title={owner.name}
                >
                  {owner.name.length > 10 ? `${owner.name.slice(0, 10)}…` : owner.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {owners.map(rowOwner => (
              <tr key={rowOwner.id}>
                <th
                  className="sticky left-0 bg-sleeper-darker p-2 text-xs text-gray-400 font-medium text-left max-w-[110px] truncate"
                  title={rowOwner.name}
                >
                  {rowOwner.name.length > 12 ? `${rowOwner.name.slice(0, 12)}…` : rowOwner.name}
                </th>
                {owners.map(colOwner => (
                  <td
                    key={colOwner.id}
                    className="p-2 text-center border-t border-gray-800/50"
                  >
                    {cellFor(rowOwner, colOwner)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
