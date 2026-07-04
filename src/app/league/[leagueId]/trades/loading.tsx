export default function TradesLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div>
        <div className="h-8 w-48 bg-gray-700 rounded animate-pulse" />
        <div className="h-5 w-64 bg-gray-800 rounded animate-pulse mt-2" />
      </div>

      {/* Trade Analyzer skeleton */}
      <div className="panel p-6">
        <div className="h-6 w-40 bg-gray-700 rounded animate-pulse mb-4" />
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="h-10 bg-gray-800 rounded animate-pulse" />
            <div className="h-10 bg-gray-800 rounded animate-pulse" />
            <div className="h-10 bg-gray-800 rounded animate-pulse" />
          </div>
          <div className="space-y-3">
            <div className="h-10 bg-gray-800 rounded animate-pulse" />
            <div className="h-10 bg-gray-800 rounded animate-pulse" />
            <div className="h-10 bg-gray-800 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Report Cards skeleton */}
      <div className="space-y-4">
        <div className="h-6 w-48 bg-gray-700 rounded animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="panel p-4 flex items-center gap-4">
            <div className="h-8 w-8 bg-gray-700 rounded animate-pulse" />
            <div className="h-12 w-12 bg-gray-700 rounded-full animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-32 bg-gray-700 rounded animate-pulse" />
              <div className="h-4 w-24 bg-gray-800 rounded animate-pulse" />
            </div>
            <div className="h-16 w-16 bg-gray-700 rounded-lg animate-pulse" />
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
          <span>Loading trade data...</span>
        </div>
      </div>
    </div>
  );
}
