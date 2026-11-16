const { formatMoney } = require('./format');

// TODO: replace with summarizeOrders from format.js
function buildReport(orders) {
  const summary = { count: 0, total: 0, largest: 0, byStatus: {} };
  for (const order of orders) {
    summary.count += 1;
    summary.total += order.total;
    if (order.total > summary.largest) {
      summary.largest = order.total;
    }
    if (!summary.byStatus[order.status]) {
      summary.byStatus[order.status] = 0;
    }
    summary.byStatus[order.status] += 1;
  }
  summary.average = summary.count ? summary.total / summary.count : 0;
  return `Orders: ${summary.count}, total ${formatMoney(summary.total)}`;
}

module.exports = { buildReport };
