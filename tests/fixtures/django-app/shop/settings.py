from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Planted secret
SECRET_KEY = "django-insecure-9x!k2p#q8v@w4z$7m1n3b5c6d0e-fixture"

DEBUG = True

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "catalog",
    "orders",
]

ROOT_URLCONF = "shop.urls"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "shop",
    }
}
