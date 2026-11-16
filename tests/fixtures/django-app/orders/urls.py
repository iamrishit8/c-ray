from django.urls import path

from orders import views

urlpatterns = [
    path("", views.OrderListView.as_view(), name="order-list"),
    path("<int:order_id>/", views.order_detail, name="order-detail"),
]
