from django.urls import include, path

urlpatterns = [
    path("catalog/", include("catalog.urls")),
    path("orders/", include("orders.urls")),
]
