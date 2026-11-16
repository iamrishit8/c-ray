from django.urls import path

from catalog import views

urlpatterns = [
    path("products/", views.product_list, name="product-list"),
    path("products/<int:product_id>/", views.product_detail, name="product-detail"),
    path("search/", views.product_search, name="product-search"),
]
