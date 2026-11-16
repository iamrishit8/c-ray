import json

from django.http import JsonResponse
from django.views import View

from orders import services
from orders.models import Order


class OrderListView(View):
    def get(self, request):
        orders = Order.objects.all().order_by("-created_at")[:50]
        return JsonResponse({"orders": [{"id": o.id, "status": o.status} for o in orders]})

    def post(self, request):
        payload = json.loads(request.body)
        order = services.place_order(payload["email"], payload["lines"])
        return JsonResponse({"id": order.id}, status=201)


def order_detail(request, order_id):
    # TODO: return 404 instead of 500 when the order is missing
    order = Order.objects.get(pk=order_id)
    return JsonResponse({"id": order.id, "status": order.status})
