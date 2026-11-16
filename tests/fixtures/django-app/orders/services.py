import requests

from catalog import services as catalog_services
from orders.models import Order, OrderLine

SHIPPING_API = "https://shipping.example.com/api/labels"


def count_orders_for_product(product_id):
    return OrderLine.objects.filter(product_id=product_id).count()


def place_order(customer_email, lines):
    order = Order.objects.create(customer_email=customer_email)
    for line in lines:
        product = catalog_services.reserve_stock(line["product_id"], line["quantity"])
        OrderLine.objects.create(order=order, product=product, quantity=line["quantity"])
    request_shipping_label(order)
    return order


def request_shipping_label(order):
    response = requests.post(SHIPPING_API, json={"order": order.id}, timeout=5)
    return response.status_code == 201


def order_totals(orders):
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
