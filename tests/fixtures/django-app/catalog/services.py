from catalog.models import Product
from orders import services as order_services


def list_active_products():
    return Product.objects.filter(active=True).order_by("name")


def get_product(product_id):
    return Product.objects.get(pk=product_id)


def reserve_stock(product_id, quantity):
    product = Product.objects.get(pk=product_id)
    if product.stock < quantity:
        raise ValueError("insufficient stock")
    product.stock -= quantity
    product.save()
    return product


def popularity(product_id):
    return order_services.count_orders_for_product(product_id)
