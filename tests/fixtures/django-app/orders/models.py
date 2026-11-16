from django.db import models

from catalog.models import Product


class Order(models.Model):
    customer_email = models.EmailField()
    status = models.CharField(max_length=20, default="new")
    created_at = models.DateTimeField(auto_now_add=True)


class OrderLine(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.IntegerField(default=1)
