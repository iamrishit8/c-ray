from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)

    def __str__(self):
        return self.name


class Product(models.Model):
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="products")
    name = models.CharField(max_length=200)
    price_cents = models.IntegerField()
    stock = models.IntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=["category", "active"])]

    def __str__(self):
        return self.name
