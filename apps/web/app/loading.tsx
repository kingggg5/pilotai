export default function Loading() {
  return (
    <main className="loading-shell" aria-label="กำลังโหลด ServicePilot AI">
      <div className="loading-sidebar skeleton" />
      <div className="loading-content">
        <div className="loading-heading skeleton" />
        <div className="loading-metrics">
          {Array.from({ length: 4 }, (_, index) => <div className="loading-card skeleton" key={index} />)}
        </div>
        <div className="loading-workspace skeleton" />
      </div>
    </main>
  );
}
