from django.db import connection
from django.http import JsonResponse

from catalog import services


def product_list(request):
    products = services.list_active_products()
    data = [{"id": p.id, "name": p.name, "price": p.price_cents} for p in products]
    return JsonResponse({"products": data})


def product_detail(request, product_id):
    product = services.get_product(product_id)
    return JsonResponse({"id": product.id, "name": product.name, "popularity": services.popularity(product.id)})


def product_search(request):
    term = request.GET.get("q", "")
    # Planted layering violation + SQL built by string concatenation.
    cursor = connection.cursor()
    cursor.execute("SELECT id, name FROM catalog_product WHERE name LIKE '%" + term + "%'")
    rows = cursor.fetchall()
    return JsonResponse({"results": [{"id": r[0], "name": r[1]} for r in rows]})
