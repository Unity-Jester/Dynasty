export default function DraftLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div>
        <div className="h-8 w-40 bg-gray-700 rounded animate-pulse" />
        <div className="h-5 w-32 bg-gray-800 rounded animate-pulse mt-2" />
      </div>

      {/* Draft Board skeleton */}
      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <div className="h-6 w-40 bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-800 rounded animate-pulse mt-1" />
        </div>
        <div className="p-4 overflow-x-auto">
          {/* Draft grid skeleton */}
          <div className="space-y-2">
            {/* Header row */}
            <div className="flex gap-1">
              <div className="w-16 h-6" />
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                <div key={i} className="w-28 h-4 bg-gray-800 rounded animate-pulse" />
              ))}
            </div>
            {/* Draft rows */}
            {[1, 2, 3, 4, 5].map((round) => (
              <div key={round} className="flex gap-1">
                <div className="w-16 h-10 flex items-center justify-center">
                  <div className="h-4 w-10 bg-gray-800 rounded animate-pulse" />
                </div>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((slot) => (
                  <div key={slot} className="w-28 h-10 bg-gray-800/50 rounded animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overall Draft Rankings skeleton */}
      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <div className="h-6 w-52 bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-64 bg-gray-800 rounded animate-pulse mt-1" />
        </div>
        <div className="divide-y divide-white/[0.05]">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="p-4">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 bg-gray-700 rounded animate-pulse" />
                  <div className="h-10 w-10 bg-gray-700 rounded-full animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="h-5 w-32 bg-gray-700 rounded animate-pulse" />
                  <div className="h-4 w-40 bg-gray-800 rounded animate-pulse mt-1" />
                </div>
                <div className="text-right">
                  <div className="h-6 w-16 bg-gray-700 rounded animate-pulse ml-auto" />
                  <div className="h-3 w-24 bg-gray-800 rounded animate-pulse mt-1 ml-auto" />
                </div>
              </div>
              {/* Best/Worst picks skeleton */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-gray-800/30 rounded-lg p-3">
                  <div className="h-3 w-24 bg-gray-700 rounded animate-pulse mb-2" />
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 bg-gray-700 rounded-full animate-pulse" />
                    <div className="flex-1">
                      <div className="h-4 w-28 bg-gray-700 rounded animate-pulse" />
                      <div className="h-3 w-36 bg-gray-800 rounded animate-pulse mt-1" />
                    </div>
                    <div className="h-4 w-12 bg-gray-700 rounded animate-pulse" />
                  </div>
                </div>
                <div className="bg-gray-800/30 rounded-lg p-3">
                  <div className="h-3 w-24 bg-gray-700 rounded animate-pulse mb-2" />
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 bg-gray-700 rounded-full animate-pulse" />
                    <div className="flex-1">
                      <div className="h-4 w-28 bg-gray-700 rounded animate-pulse" />
                      <div className="h-3 w-36 bg-gray-800 rounded animate-pulse mt-1" />
                    </div>
                    <div className="h-4 w-12 bg-gray-700 rounded animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Loading indicator */}
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Loading draft data...</span>
        </div>
      </div>
    </div>
  );
}
