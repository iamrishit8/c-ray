from celery import shared_task

from orders.models import Order


@shared_task
def expire_stale_orders():
    Order.objects.filter(status="new").update(status="expired")


def stale_totals(orders):
    totals = {"count": 0, "items": 0, "largest": 0}
    for order in orders:
        totals["count"] += 1
        line_count = order.lines.count()
        totals["items"] += line_count
        if line_count > totals["largest"]:
            totals["largest"] = line_count
    if totals["count"]:
        totals["average"] = totals["items"] / totals["count"]
    else:
        totals["average"] = 0
    return totals
