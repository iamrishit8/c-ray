package com.acme.shop.controller;

import com.acme.shop.model.Product;
import com.acme.shop.service.ProductService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping
    public List<Product> list() {
        return productService.listProducts();
    }

    @GetMapping("/{sku}")
    public Product get(@PathVariable String sku) {
        return productService.getBySku(sku);
    }
}
