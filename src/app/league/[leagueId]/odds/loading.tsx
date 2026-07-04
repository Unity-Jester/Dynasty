export default function OddsLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-8 w-48 bg-gray-700 rounded animate-pulse" />
        <div className="h-5 w-72 bg-gray-800 rounded animate-pulse mt-2" />
      </div>
      <div className="panel p-4 space-y-3">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-7 w-7 bg-gray-700 rounded-full animate-pulse" />
            <div className="h-4 w-36 bg-gray-700 rounded animate-pulse" />
            <div className="h-2 flex-1 bg-gray-800 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Simulating 2,500 seasons...</span>
        </div>
      </div>
    </div>
  );
}
