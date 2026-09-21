import clsx from 'clsx';

function Bone({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-white/[0.1]', className)} />;
}

/** Esqueleto con la misma rejilla que el dashboard para que no haya saltos al cargar. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-7" aria-busy="true" aria-label="Cargando tu resumen">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <div className="dash-card flex items-center gap-5 p-5 sm:px-8 sm:py-7">
          <Bone className="size-16 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2.5">
            <Bone className="h-3.5 w-40" />
            <Bone className="h-8 w-3/5" />
            <Bone className="h-3.5 w-48" />
          </div>
        </div>
        <div className="dash-card flex items-center gap-4 p-5 sm:px-7">
          <Bone className="size-12 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Bone className="h-3 w-44" />
            <Bone className="h-6 w-36" />
            <Bone className="h-3 w-28" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={clsx('dash-card space-y-3 p-4 sm:px-6 sm:py-5', i === 4 && 'max-md:col-span-2')}>
            <Bone className="h-3 w-24" />
            <Bone className="h-8 w-20" />
            <Bone className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="dash-card h-80 p-6 lg:col-span-2">
          <Bone className="h-6 w-64" />
          <Bone className="mt-8 h-52 w-full rounded-xl" />
        </div>
        <div className="dash-card h-80 p-6">
          <Bone className="h-6 w-44" />
          <Bone className="mt-5 h-44 w-full rounded-xl" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="dash-card space-y-3 p-6">
            <Bone className="h-6 w-52" />
            {Array.from({ length: 4 }).map((__, j) => (
              <Bone key={j} className="h-14 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
