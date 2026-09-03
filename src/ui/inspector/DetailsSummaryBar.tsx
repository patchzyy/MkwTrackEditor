/**
 * Compact stat strip at the top of the inspector: label above value, one card per item.
 * Empty values are dropped so callers can pass conditional rows unconditionally.
 */
export function DetailsSummaryBar({ items }: { items: Array<{ label: string; value: string }> }) {
  const visibleItems = items.filter((item) => item.value.trim().length > 0);
  if (visibleItems.length === 0) return null;
  return (
    <div className="detailsSummaryBar">
      {visibleItems.map((item) => (
        <div className="detailsSummaryItem" key={`${item.label}-${item.value}`}>
          <span>{item.label}</span>
          <strong title={item.value}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
