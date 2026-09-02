export function DetailsSummaryBar({ items }: { items: Array<{ label: string; value: string }> }) {
  const visibleItems = items.filter((item) => item.value.trim().length > 0);
  if (visibleItems.length === 0) return null;
  return (
    <div className="detailsSummaryBar">
      {visibleItems.map((item) => (
        <div className="detailsSummaryItem" key={`${item.label}-${item.value}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
