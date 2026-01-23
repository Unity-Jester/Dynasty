export default function MatchupsLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex justify-between items-center">
        <div>
          <div className="h-8 w-48 bg-gray-700 rounded animate-pulse" />
          <div className="h-5 w-64 bg-gray-800 rounded animate-pulse mt-2" />
        </div>
        {/* Week selector skeleton */}
        <div className="h-10 w-32 bg-gray-700 rounded animate-pulse" />
      </div>

      {/* Matchup cards skeleton */}
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-sleeper-darker rounded-lg p-4">
            <div className="flex items-center justify-between">
              {/* Team 1 */}
              <div className="flex items-center gap-3 flex-1">
                <div className="h-10 w-10 bg-gray-700 rounded-full animate-pulse" />
                <div className="space-y-2">
                  <div className="h-4 w-24 bg-gray-700 rounded animate-pulse" />
                  <div className="h-6 w-16 bg-gray-800 rounded animate-pulse" />
                </div>
              </div>

              {/* VS */}
              <div className="h-6 w-8 bg-gray-800 rounded animate-pulse mx-4" />

              {/* Team 2 */}
              <div className="flex items-center gap-3 flex-1 justify-end">
                <div className="space-y-2 text-right">
                  <div className="h-4 w-24 bg-gray-700 rounded animate-pulse ml-auto" />
                  <div className="h-6 w-16 bg-gray-800 rounded animate-pulse ml-auto" />
                </div>
                <div className="h-10 w-10 bg-gray-700 rounded-full animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Loading indicator */}
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Loading matchups...</span>
        </div>
      </div>
    </div>
  );
}
